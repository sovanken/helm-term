// Screens the browser can emulate for responsive testing. Sizes are CSS pixels (portrait).

export interface DeviceSpec {
  id: string;
  label: string;
  group: "Phones" | "Tablets" | "Computers";
  width: number;
  height: number;
  scaleFactor: number;
  mobile: boolean;
  touch: boolean;
  userAgent?: string;
}

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = (model: string) => `Mozilla/5.0 (Linux; Android 15; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36`;
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const DEVICES: DeviceSpec[] = [
  { id: "iphone-15-pro", label: "iPhone 15 Pro", group: "Phones", width: 393, height: 852, scaleFactor: 3, mobile: true, touch: true, userAgent: IOS },
  { id: "iphone-se", label: "iPhone SE", group: "Phones", width: 375, height: 667, scaleFactor: 2, mobile: true, touch: true, userAgent: IOS },
  { id: "iphone-15-pro-max", label: "iPhone 15 Pro Max", group: "Phones", width: 430, height: 932, scaleFactor: 3, mobile: true, touch: true, userAgent: IOS },
  { id: "pixel-8", label: "Pixel 8", group: "Phones", width: 412, height: 915, scaleFactor: 2.625, mobile: true, touch: true, userAgent: ANDROID("Pixel 8") },
  { id: "galaxy-s24", label: "Galaxy S24", group: "Phones", width: 360, height: 780, scaleFactor: 3, mobile: true, touch: true, userAgent: ANDROID("SM-S921B") },
  { id: "ipad-air", label: "iPad Air", group: "Tablets", width: 820, height: 1180, scaleFactor: 2, mobile: true, touch: true, userAgent: IPAD },
  { id: "ipad-pro-13", label: "iPad Pro 13″", group: "Tablets", width: 1032, height: 1376, scaleFactor: 2, mobile: true, touch: true, userAgent: IPAD },
  { id: "galaxy-tab-s9", label: "Galaxy Tab S9", group: "Tablets", width: 800, height: 1280, scaleFactor: 2, mobile: true, touch: true, userAgent: ANDROID_TABLET },
  { id: "laptop", label: "Laptop", group: "Computers", width: 1366, height: 768, scaleFactor: 1, mobile: false, touch: false },
  { id: "laptop-hd", label: "Laptop HD", group: "Computers", width: 1440, height: 900, scaleFactor: 1, mobile: false, touch: false },
  { id: "desktop", label: "Desktop", group: "Computers", width: 1920, height: 1080, scaleFactor: 1, mobile: false, touch: false },
];

/** "custom:390x844" → a phone-like screen of that size. */
export function deviceById(id: string | undefined): DeviceSpec | undefined {
  if (!id) return undefined;
  const custom = /^custom:(\d{2,4})x(\d{2,4})$/.exec(id);
  if (custom) {
    const [width, height] = [Number(custom[1]), Number(custom[2])];
    const phone = width < 768;
    return { id, label: "Custom", group: "Phones", width, height, scaleFactor: phone ? 3 : 1, mobile: phone, touch: phone };
  }
  return DEVICES.find((d) => d.id === id);
}

/** Size on screen, landscape when rotated. */
export function screenSize(d: DeviceSpec, rotated?: boolean) {
  // Computers are already landscape; rotating them shows portrait.
  return rotated ? { width: d.height, height: d.width } : { width: d.width, height: d.height };
}
