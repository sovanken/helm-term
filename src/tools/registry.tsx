import { type ComponentType, lazy, type ReactNode } from "react";
import { t } from "../i18n";
import {
  Binary,
  Braces,
  Clock,
  Diff,
  FingerprintPattern,
  Image,
  Network,
  NotebookPen,
  Palette,
  Regex,
  Ruler,
  Send,
  TextQuote,
  Variable,
} from "lucide-react";

export type ToolId =
  | "color"
  | "image"
  | "ruler"
  | "json"
  | "encode"
  | "regex"
  | "diff"
  | "generate"
  | "time"
  | "placeholder"
  | "ports"
  | "http"
  | "env"
  | "scratchpad";

export interface ToolInfo {
  id: ToolId;
  /** Shown name, in the current language. */
  readonly label: string;
  group: "Design" | "Data" | "Generators" | "System";
  /** One line under the name in the tools list (current language). */
  readonly blurb: string;
  icon: (size: number) => ReactNode;
  /** Extra words the command palette matches on. */
  keywords: string;
  view: ComponentType;
}

type ToolGroup = ToolInfo["group"];

/** A tool entry whose label and blurb are translated each time they're read. */
function tool(id: ToolId, group: ToolGroup, icon: ToolInfo["icon"], keywords: string, view: ComponentType): ToolInfo {
  return {
    id,
    group,
    icon,
    keywords,
    view,
    get label() {
      return t(`tools.list.${id}.label`);
    },
    get blurb() {
      return t(`tools.list.${id}.blurb`);
    },
  };
}

export const TOOLS: ToolInfo[] = [
  tool("color", "Design", (s) => <Palette size={s} />, "colour hex rgb hsl oklch eyedropper contrast tailwind flutter", lazy(() => import("./ColorTool"))),
  tool("image", "Design", (s) => <Image size={s} />, "png jpg webp resize compress base64 data uri", lazy(() => import("./ImageTool"))),
  tool("ruler", "Design", (s) => <Ruler size={s} />, "measure pixels distance size screenshot", lazy(() => import("./RulerTool"))),
  tool("json", "Data", (s) => <Braces size={s} />, "format validate minify yaml typescript types prettify", lazy(() => import("./JsonTool"))),
  tool("encode", "Data", (s) => <Binary size={s} />, "base64 url encode decode html entities jwt token", lazy(() => import("./EncodeTool"))),
  tool("regex", "Data", (s) => <Regex size={s} />, "regular expression pattern match test", lazy(() => import("./RegexTool"))),
  tool("diff", "Data", (s) => <Diff size={s} />, "diff compare difference text", lazy(() => import("./DiffTool"))),
  tool("generate", "Generators", (s) => <FingerprintPattern size={s} />, "uuid guid password random hash sha256 sha1 md5 checksum", lazy(() => import("./GenerateTool"))),
  tool("time", "Generators", (s) => <Clock size={s} />, "unix timestamp epoch date time zone iso", lazy(() => import("./TimeTool"))),
  tool("placeholder", "Generators", (s) => <TextQuote size={s} />, "lorem ipsum fake data names emails json csv", lazy(() => import("./PlaceholderTool"))),
  tool("ports", "System", (s) => <Network size={s} />, "port in use listening kill process stop server", lazy(() => import("./PortsTool"))),
  tool("http", "System", (s) => <Send size={s} />, "http api request rest postman get post curl", lazy(() => import("./HttpTool"))),
  tool("env", "System", (s) => <Variable size={s} />, "env environment path variables", lazy(() => import("./EnvTool"))),
  tool("scratchpad", "System", (s) => <NotebookPen size={s} />, "notes scratch memo todo", lazy(() => import("./ScratchpadTool"))),
];

export const TOOL_GROUPS = ["Design", "Data", "Generators", "System"] as const;

/** A group's heading, in the current language (the group values themselves stay as ids). */
export function groupLabel(group: ToolGroup) {
  return t(`tools.groups.${group.toLowerCase()}`);
}

export function toolById(id: ToolId) {
  return TOOLS.find((x) => x.id === id) ?? TOOLS[0];
}
