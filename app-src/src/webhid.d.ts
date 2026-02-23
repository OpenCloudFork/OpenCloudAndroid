interface HIDDevice {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName: string;
  collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: string, listener: (event: HIDInputReportEvent) => void): void;
  removeEventListener(type: string, listener: (event: HIDInputReportEvent) => void): void;
}

interface HIDInputReportEvent extends Event {
  device: HIDDevice;
  reportId: number;
  data: DataView;
}

interface HIDCollectionInfo {
  usage: number;
  usagePage: number;
  type: number;
  children: HIDCollectionInfo[];
  inputReports: HIDReportInfo[];
  outputReports: HIDReportInfo[];
  featureReports: HIDReportInfo[];
}

interface HIDReportInfo {
  reportId: number;
  items: HIDReportItem[];
}

interface HIDReportItem {
  isAbsolute: boolean;
  isArray: boolean;
  isRange: boolean;
  hasNull: boolean;
  usages: number[];
  usageMinimum: number;
  usageMaximum: number;
  reportSize: number;
  reportCount: number;
  logicalMinimum: number;
  logicalMaximum: number;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: Array<{ vendorId?: number; productId?: number; usagePage?: number; usage?: number }> }): Promise<HIDDevice[]>;
}

interface Navigator {
  hid?: HID;
}
