#!/usr/bin/env python3
"""Inspect IGN/data.gouv terrain packages before downloading them."""

from __future__ import annotations

import argparse
import ssl
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree


DATASETS = {
    "bd_alti": {
        "slug": "bd-alti-r-1",
        "label": "BD ALTI",
        "role": "Relief national leger, cible initiale 25 m.",
        "geopf": [("archive_BDALTI_COG", "archive", "BD ALTI 25 m COG France metropolitaine")],
    },
    "rge_alti": {
        "slug": "rge-alti-r",
        "label": "RGE ALTI",
        "role": "Relief precis 5 m / 1 m selon paquets disponibles.",
        "geopf": [],
    },
    "mnt_lidar_hd": {
        "slug": "mnt-lidar-hd",
        "label": "MNT LiDAR HD",
        "role": "Tres precis, a limiter aux zones pilotes sous budget.",
        "geopf": [],
    },
    "france_relief": {
        "slug": "",
        "label": "France RELIEF",
        "role": "Jeux de donnees altimetriques pilotes MNT/MNS/MNH.",
        "geopf": [],
    },
}

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "gpf_dl": "https://data.geopf.fr/annexes/ressources/xsd/gpf_dl.xsd"}
WARNINGS: list[str] = []


@dataclass(frozen=True)
class ResourceInfo:
    dataset_key: str
    dataset_label: str
    title: str
    url: str
    size_bytes: int | None

    @property
    def size_gb(self) -> float | None:
        if self.size_bytes is None:
            return None
        return self.size_bytes / (1024**3)


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "FireLogisticsTerrainInspector/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "FireLogisticsTerrainInspector/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()
    except urllib.error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        WARNINGS.append("Certificat Python refuse pour data.geopf.fr; retry sans verification TLS pour les metadonnees publiques.")
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(request, timeout=30, context=context) as response:
            return response.read()


def parse_atom_links(xml_bytes: bytes) -> list[dict[str, Any]]:
    root = ElementTree.fromstring(xml_bytes)
    items: list[dict[str, Any]] = []
    for entry in root.findall("atom:entry", ATOM_NS):
        title_node = entry.find("atom:title", ATOM_NS)
        title = title_node.text.strip() if title_node is not None and title_node.text else "resource"
        links = []
        for link in entry.findall("atom:link", ATOM_NS):
            links.append({key: value for key, value in link.attrib.items()})
        items.append({"title": title, "links": links})
    return items


def parse_size(resource: dict[str, Any]) -> int | None:
    for key in ("filesize", "file_size", "size"):
        value = resource.get(key)
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str):
            try:
                parsed = int(value)
                if parsed > 0:
                    return parsed
            except ValueError:
                pass
    return None


def collect_geopf_subresource_files(dataset_key: str, dataset: dict[str, Any]) -> list[ResourceInfo]:
    resources: list[ResourceInfo] = []
    for resource_name, subresource_name, label in dataset.get("geopf", []):
        url = f"https://data.geopf.fr/telechargement/resource/{resource_name}/{subresource_name}?page=1&limit=500"
        for item in parse_atom_links(fetch_bytes(url)):
            for link in item["links"]:
                href = link.get("href", "")
                size = link.get(f"{{{ATOM_NS['gpf_dl']}}}length") or link.get("gpf_dl:length")
                try:
                    size_bytes = int(size) if size else None
                except ValueError:
                    size_bytes = None
                if "/telechargement/download/" not in href:
                    continue
                file_title = item["title"]
                if file_title == "resource":
                    file_title = os.path.basename(urllib.parse.urlparse(href).path)
                resources.append(
                    ResourceInfo(
                        dataset_key=dataset_key,
                        dataset_label=dataset["label"],
                        title=f"{label} - {file_title}",
                        url=href,
                        size_bytes=size_bytes,
                    )
                )
    return resources


def collect_resources(dataset_key: str, dataset: dict[str, str]) -> list[ResourceInfo]:
    resources = collect_geopf_subresource_files(dataset_key, dataset)
    slug = dataset.get("slug", "")
    if not slug:
        return resources

    slug = dataset["slug"]
    payload = fetch_json(f"https://www.data.gouv.fr/api/1/datasets/{slug}/")
    for resource in payload.get("resources", []):
        url = resource.get("url") or resource.get("latest") or ""
        title = resource.get("title") or resource.get("description") or "resource"
        resources.append(
            ResourceInfo(
                dataset_key=dataset_key,
                dataset_label=dataset["label"],
                title=str(title).strip(),
                url=str(url).strip(),
                size_bytes=parse_size(resource),
            )
        )
    return resources


def matches_keywords(resource: ResourceInfo, keywords: list[str]) -> bool:
    if not keywords:
        return True
    haystack = f"{resource.title} {resource.url}".lower()
    return any(keyword.lower() in haystack for keyword in keywords)


def format_size(size_bytes: int | None) -> str:
    if size_bytes is None:
        return "taille inconnue"
    gb = size_bytes / (1024**3)
    if gb >= 1:
        return f"{gb:.2f} Go"
    mb = size_bytes / (1024**2)
    return f"{mb:.1f} Mo"


def build_report(resources: list[ResourceInfo], max_download_gb: float) -> dict[str, Any]:
    known_total = sum(resource.size_bytes or 0 for resource in resources)
    unknown_count = sum(1 for resource in resources if resource.size_bytes is None)
    known_gb = known_total / (1024**3)
    downloadable_count = sum(1 for resource in resources if resource.url)
    return {
        "maxDownloadGb": max_download_gb,
        "knownTotalGb": round(known_gb, 3),
        "unknownResourceCount": unknown_count,
        "downloadableResourceCount": downloadable_count,
        "withinKnownBudget": known_gb <= max_download_gb,
        "readyForBatchDownload": known_gb <= max_download_gb and unknown_count == 0 and downloadable_count > 0,
        "resources": [
            {
                "dataset": resource.dataset_label,
                "title": resource.title,
                "url": resource.url,
                "sizeBytes": resource.size_bytes,
                "sizeGb": None if resource.size_gb is None else round(resource.size_gb, 3),
            }
            for resource in resources
        ],
    }


def print_human_report(report: dict[str, Any]) -> None:
    print("Fire Logistics - inspection relief IGN/data.gouv")
    print(f"Budget telechargement: {report['maxDownloadGb']:.1f} Go")
    print(f"Total connu selectionne: {report['knownTotalGb']:.3f} Go")
    print(f"Ressources sans taille publiee: {report['unknownResourceCount']}")
    print(f"Sous budget connu: {'oui' if report['withinKnownBudget'] else 'non'}")
    print(f"Pret pour batch automatique: {'oui' if report['readyForBatchDownload'] else 'non'}")
    print()
    for resource in report["resources"]:
        size = format_size(resource["sizeBytes"])
        print(f"- [{resource['dataset']}] {resource['title']} | {size}")
        if resource["url"]:
            print(f"  {resource['url']}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-download-gb", type=float, default=50.0)
    parser.add_argument(
        "--dataset",
        choices=sorted(DATASETS.keys()),
        action="append",
        help="Dataset a inspecter. Par defaut, inspecte les trois sources connues.",
    )
    parser.add_argument(
        "--keyword",
        action="append",
        default=[],
        help="Filtre simple sur le titre ou l'URL, par exemple 25m, 5m, 1m, 13, Bouches.",
    )
    parser.add_argument("--json", action="store_true", help="Sortie JSON machine-readable.")
    parser.add_argument("--write-manifest", help="Chemin d'un rapport JSON a ecrire.")
    parser.add_argument(
        "--skip-datagouv-services",
        action="store_true",
        help="Ne garde que les fichiers telechargeables Geoplateforme connus.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    dataset_keys = args.dataset or list(DATASETS.keys())
    resources: list[ResourceInfo] = []

    for key in dataset_keys:
        try:
            collected = collect_resources(key, DATASETS[key])
            if args.skip_datagouv_services:
                collected = [resource for resource in collected if "/telechargement/download/" in resource.url]
            resources.extend(collected)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            print(f"Erreur inspection {DATASETS[key]['label']}: {exc}", file=sys.stderr)
            return 2

    filtered = [resource for resource in resources if matches_keywords(resource, args.keyword)]
    report = build_report(filtered, args.max_download_gb)

    if args.write_manifest:
        with open(args.write_manifest, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
            handle.write("\n")

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human_report(report)
        for warning in WARNINGS:
            print(f"WARNING: {warning}", file=sys.stderr)

    if not report["withinKnownBudget"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
