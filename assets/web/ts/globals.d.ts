declare const require: any;
declare const module: any;

interface Window {
  FireLogistics?: any;
  FireLogisticsFire?: any;
  FireLogisticsFireModel?: any;
  GodotBridge?: { postMessage(message: string): void };
  godot?: { ipc?: { postMessage(message: string): void } };
  ipc?: { postMessage(message: string): void };
  maplibregl?: any;
  pmtiles?: any;
}

declare var globalThis: any;
