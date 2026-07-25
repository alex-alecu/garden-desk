import { useEffect, useState } from "react";

export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedAppearance = Exclude<AppearancePreference, "system">;

const appearanceOrder: AppearancePreference[] = ["system", "light", "dark"];

export function nextAppearance(preference: AppearancePreference): AppearancePreference {
  const current = appearanceOrder.indexOf(preference);
  return appearanceOrder[(current + 1) % appearanceOrder.length] ?? "system";
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedAppearance {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

export function useAppearance() {
  const [preference, setPreference] = useState<AppearancePreference>("system");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (media === undefined) return;
    const updateSystemAppearance = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener("change", updateSystemAppearance);
    return () => media.removeEventListener("change", updateSystemAppearance);
  }, []);

  return {
    preference,
    resolved: resolveAppearance(preference, systemDark),
    cycle: () => setPreference(nextAppearance),
  };
}
