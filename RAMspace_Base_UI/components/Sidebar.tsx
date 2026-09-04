"use client";

import { ChevronRight, Shield } from "lucide-react";
import { modules, type ModuleKey } from "@/lib/modules";

interface SidebarProps {
  activeModule: ModuleKey;
  onModuleChange: (module: ModuleKey) => void;
}

export default function Sidebar({ activeModule, onModuleChange }: SidebarProps) {
  return (
    <aside
      style={{ width: "260px", minWidth: "260px" }}
      className="flex flex-col h-screen bg-[#0f172a] border-r border-slate-700/60"
    >
      {/* Logo / Header */}
      <div className="px-4 py-5 border-b border-slate-700/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">RAMspace</div>
            <div className="text-slate-400 text-xs">EN 50126 · IEC 61078</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest px-3 mb-2">
          Analysis Modules
        </div>
        <ul className="space-y-0.5">
          {modules.map((item) => {
            const isActive = activeModule === item.key;
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <button
                  onClick={() => onModuleChange(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 group
                    ${
                      isActive
                        ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                >
                  <span className={isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300"}>
                    <Icon size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium truncate ${isActive ? "text-blue-300" : ""}`}>
                      {item.label}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{item.description}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!item.component && (
                      <span className="text-[9px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-medium">
                        SOON
                      </span>
                    )}
                    {isActive && <ChevronRight size={12} className="text-blue-400" />}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-700/60">
        <div className="text-slate-600 text-[10px] text-center">
          RAMspace v1.0 · Rail Sector
        </div>
      </div>
    </aside>
  );
}
