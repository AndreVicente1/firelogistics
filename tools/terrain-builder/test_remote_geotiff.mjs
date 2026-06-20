import { fromUrl } from "geotiff";

const realUrl = "https://data.cquest.org/ign/rgealti/repack/cog/RGEALTI_2-0_1M_COG_LAMB93-IGN69_D013_2018-11-30.tif";

async function main() {
  console.log("Opening remote GeoTIFF:", realUrl);
  try {
    const tiff = await fromUrl(realUrl);
    const image = await tiff.getImage();
    console.log("Image size:", image.getWidth(), "x", image.getHeight());
    console.log("Tie points:", image.getTiePoints());
  } catch (error) {
    console.error("Error opening remote GeoTIFF:", error);
  }
}

main();
