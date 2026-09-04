"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import ComingSoon from "@/components/ComingSoon";
import { getModule, type ModuleKey } from "@/lib/modules";

export default function Home() {
  const [activeModule, setActiveModule] = useState<ModuleKey>("data-register");
  const active = getModule(activeModule);
  const ActiveModule = active.component;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />
      <main className="flex-1 overflow-hidden">
        {ActiveModule ? <ActiveModule /> : <ComingSoon module={activeModule} />}
      </main>
    </div>
  );
}
