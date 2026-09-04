import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  BarChart2,
  AlertTriangle,
  DollarSign,
  Package,
  Calculator,
  Network,
  Activity,
  CheckSquare,
  Database,
} from "lucide-react";
import DataRegister from "@/components/DataRegister";
import RBDSheet from "@/components/RBDSheet";

/* ─────────────────────────────────────────────────────────────
 *  Module Registry — the single place to manage modules.
 *
 *  To add a module later:
 *    1. Add its key to ModuleKey.
 *    2. Add an entry below with label / icon / description.
 *    3. When the module UI is built, import it and set `component`.
 *       Until then, the shell shows the "Coming soon" placeholder
 *       and the sidebar shows the "SOON" badge automatically.
 *
 *  Example:
 *    import RBDModule from "@/components/modules/RBDModule";
 *    { key: "rbd", ..., component: RBDModule },
 * ───────────────────────────────────────────────────────────── */

export type ModuleKey =
  | "data-register"
  | "rbd"
  | "ram-analysis"
  | "fmeca"
  | "lcc"
  | "spare-parts"
  | "reliability-calc"
  | "fta"
  | "ram-monitoring"
  | "ram-demo";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  /** React component rendered for this module. Undefined → "Coming soon" placeholder. */
  component?: ComponentType;
}

export const modules: ModuleDef[] = [
  {
    key: "data-register",
    label: "Data Register",
    shortLabel: "Data Register",
    icon: Database,
    description: "Component / LRU registration",
    component: DataRegister,
  },
  {
    key: "rbd",
    label: "Reliability Block Diagram",
    shortLabel: "RBD",
    icon: GitBranch,
    description: "IEC 61078 compliant block diagrams",
    component: RBDSheet,
  },
  {
    key: "ram-analysis",
    label: "RAM Analysis / Prediction",
    shortLabel: "RAM Analysis",
    icon: BarChart2,
    description: "EN 50126 RAM prediction",
  },
  {
    key: "fmeca",
    label: "FMECA",
    shortLabel: "FMECA",
    icon: AlertTriangle,
    description: "Failure Mode Effects & Criticality",
  },
  {
    key: "lcc",
    label: "Life Cycle Cost",
    shortLabel: "LCC",
    icon: DollarSign,
    description: "LCC analysis & modelling",
  },
  {
    key: "spare-parts",
    label: "Spare Parts Analysis",
    shortLabel: "Spare Parts",
    icon: Package,
    description: "Spare parts optimisation",
  },
  {
    key: "reliability-calc",
    label: "Reliability Calculations",
    shortLabel: "Reliability Calc",
    icon: Calculator,
    description: "MTBF, MTTR, availability calc",
  },
  {
    key: "fta",
    label: "Fault Tree Analysis",
    shortLabel: "FTA",
    icon: Network,
    description: "Top-down failure analysis",
  },
  {
    key: "ram-monitoring",
    label: "RAM Monitoring",
    shortLabel: "RAM Monitoring",
    icon: Activity,
    description: "Performance tracking & KPIs",
  },
  {
    key: "ram-demo",
    label: "RAM Demonstration",
    shortLabel: "RAM Demo",
    icon: CheckSquare,
    description: "Compliance demonstration",
  },
];

export function getModule(key: ModuleKey): ModuleDef {
  return modules.find((m) => m.key === key) ?? modules[0];
}
