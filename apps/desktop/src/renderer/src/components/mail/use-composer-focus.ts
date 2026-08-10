import type { FocusEventHandler } from "react";
import { useCallback, useRef } from "react";

type ComposerFieldFocusTarget =
  | "attachment"
  | "bcc"
  | "cc"
  | "message"
  | "subject"
  | "to";

export type ComposerFocusTarget =
  | ComposerFieldFocusTarget
  | `account:${string}`;

type FocusRef = (element: HTMLElement | null) => void;

export interface ComposerFocusHandle {
  readonly element: HTMLElement;
  readonly focus: () => void;
}

type FocusHandleRef = (handle: ComposerFocusHandle | null) => void;

const canFocus = (element: HTMLElement | undefined): element is HTMLElement =>
  element !== undefined &&
  element.isConnected &&
  !(element instanceof HTMLButtonElement && element.disabled) &&
  !(element instanceof HTMLInputElement && element.disabled);

export const useComposerFocus = () => {
  const handlesRef = useRef(
    new Map<ComposerFocusTarget, ComposerFocusHandle>()
  );
  const handleRefCallbacksRef = useRef(
    new Map<ComposerFocusTarget, FocusHandleRef>()
  );
  const refCallbacksRef = useRef(new Map<ComposerFocusTarget, FocusRef>());
  const currentTargetRef = useRef<ComposerFocusTarget | null>(null);
  const pendingTargetRef = useRef<ComposerFocusTarget | null>(null);

  const registerHandle = useCallback(
    (target: ComposerFocusTarget, handle: ComposerFocusHandle | null): void => {
      if (handle === null) {
        handlesRef.current.delete(target);
        return;
      }

      handlesRef.current.set(target, handle);
      if (pendingTargetRef.current === target && canFocus(handle.element)) {
        pendingTargetRef.current = null;
        handle.focus();
      }
    },
    []
  );

  const refFor = useCallback(
    (target: ComposerFocusTarget): FocusRef => {
      const existing = refCallbacksRef.current.get(target);
      if (existing !== undefined) {
        return existing;
      }

      const callback: FocusRef = (element) => {
        registerHandle(
          target,
          element === null
            ? null
            : {
                element,
                focus: () => element.focus({ preventScroll: true }),
              }
        );
      };
      refCallbacksRef.current.set(target, callback);
      return callback;
    },
    [registerHandle]
  );

  const handleRefFor = useCallback(
    (target: ComposerFocusTarget): FocusHandleRef => {
      const existing = handleRefCallbacksRef.current.get(target);
      if (existing !== undefined) {
        return existing;
      }

      const callback: FocusHandleRef = (handle) => {
        registerHandle(target, handle);
      };
      handleRefCallbacksRef.current.set(target, callback);
      return callback;
    },
    [registerHandle]
  );

  const getElement = useCallback(
    (target: ComposerFocusTarget): HTMLElement | null => {
      const element = handlesRef.current.get(target)?.element;
      return canFocus(element) ? element : null;
    },
    []
  );

  const getReturnElement = useCallback(
    (): HTMLElement | null =>
      (pendingTargetRef.current === null
        ? null
        : getElement(pendingTargetRef.current)) ??
      (currentTargetRef.current === null
        ? null
        : getElement(currentTargetRef.current)) ??
      getElement("to"),
    [getElement]
  );

  const onFocusCapture = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      for (const [target, { element }] of handlesRef.current) {
        if (
          element === event.target ||
          element.contains(event.target as Node)
        ) {
          currentTargetRef.current = target;
          return;
        }
      }
    },
    []
  );

  const requestRestore = useCallback(
    (target?: ComposerFocusTarget | null): void => {
      pendingTargetRef.current =
        target === undefined ? currentTargetRef.current : target;
    },
    []
  );

  const restorePending = useCallback((): void => {
    const target = pendingTargetRef.current;
    if (target === null) {
      return;
    }

    const handle = handlesRef.current.get(target);
    if (handle !== undefined && canFocus(handle.element)) {
      pendingTargetRef.current = null;
      handle.focus();
    }
  }, []);

  const getCurrentTarget = useCallback(
    (): ComposerFocusTarget | null => currentTargetRef.current,
    []
  );

  return {
    getCurrentTarget,
    getElement,
    getReturnElement,
    handleRefFor,
    onFocusCapture,
    refFor,
    requestRestore,
    restorePending,
  };
};
