import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getTopHotkeyLayer,
  isHotkeyScopeActive,
  registerHotkeyLayer,
  removeHotkeyLayer,
} from "@/hotkeys/layer-model";
import type {
  HotkeyLayer,
  HotkeyScope,
  LayerRegistration,
} from "@/hotkeys/layer-model";

interface AppHotkeysContextValue {
  readonly isScopeActive: (scope: HotkeyScope) => boolean;
  readonly registerLayer: (id: string, layer: HotkeyLayer) => void;
  readonly removeLayer: (id: string) => void;
}

const AppHotkeysContext = createContext<AppHotkeysContextValue | null>(null);

const useAppHotkeysContext = (): AppHotkeysContextValue => {
  const context = useContext(AppHotkeysContext);

  if (context === null) {
    throw new Error("Hotkey hooks must be used within AppHotkeysProvider");
  }

  return context;
};

export const AppHotkeysProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [registrations, setRegistrations] = useState<
    readonly LayerRegistration[]
  >([]);
  const activationCounterRef = useRef(0);

  const registerLayer = useCallback((id: string, layer: HotkeyLayer): void => {
    activationCounterRef.current += 1;
    const activatedAt = activationCounterRef.current;

    setRegistrations((current) =>
      registerHotkeyLayer(current, { activatedAt, id, layer })
    );
  }, []);

  const removeLayer = useCallback((id: string): void => {
    setRegistrations((current) => removeHotkeyLayer(current, id));
  }, []);

  const topLayer = getTopHotkeyLayer(registrations);
  const value = useMemo<AppHotkeysContextValue>(
    () => ({
      isScopeActive: (scope) => isHotkeyScopeActive(scope, topLayer),
      registerLayer,
      removeLayer,
    }),
    [registerLayer, removeLayer, topLayer]
  );

  return (
    <AppHotkeysContext.Provider value={value}>
      {children}
    </AppHotkeysContext.Provider>
  );
};

export const useHotkeyLayer = (layer: HotkeyLayer, enabled: boolean): void => {
  const { registerLayer, removeLayer } = useAppHotkeysContext();
  const id = useId();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    registerLayer(id, layer);

    return () => {
      removeLayer(id);
    };
  }, [enabled, id, layer, registerLayer, removeLayer]);
};

export const useIsHotkeyScopeActive = (scope: HotkeyScope): boolean =>
  useAppHotkeysContext().isScopeActive(scope);
