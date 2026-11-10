export interface ManagedWindowFocusOptions {
  onEnterGroup?(): void;
  onLeaveGroup?(): void;
  setTimer?: (callback: () => void) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Treats a root window and registered child windows as one focus group. */
export class ManagedWindowFocusGroup {
  private readonly windows = new Map<Window, () => void>();
  private active?: Window;
  private groupActive = false;
  private transitionTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private readonly options: ManagedWindowFocusOptions;
  private readonly setTimer: (
    callback: () => void,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(root: Window, options: ManagedWindowFocusOptions = {}) {
    this.options = options;
    this.setTimer = options.setTimer ?? ((callback) => setTimeout(callback, 0));
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.attach(root);
  }

  add(window: Window): () => void {
    if (this.disposed) return () => {};
    this.attach(window);
    return () => this.detach(window);
  }

  contains(window: Window | null | undefined): boolean {
    return Boolean(window && this.windows.has(window));
  }

  get activeWindow(): Window | undefined {
    return this.active;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.transitionTimer !== undefined)
      this.clearTimer(this.transitionTimer);
    this.transitionTimer = undefined;
    for (const [window, cleanup] of this.windows) {
      cleanup();
      this.windows.delete(window);
    }
    this.active = undefined;
  }

  private attach(window: Window): void {
    if (this.windows.has(window)) return;
    const onFocus = () => this.setActive(window);
    const onBlur = () => {
      if (this.active === window) this.active = undefined;
      if (this.transitionTimer !== undefined)
        this.clearTimer(this.transitionTimer);
      this.transitionTimer = this.setTimer(() => {
        this.transitionTimer = undefined;
        if (!this.disposed && !this.active && this.groupActive) {
          this.groupActive = false;
          this.options.onLeaveGroup?.();
        }
      });
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    this.windows.set(window, () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    });
  }

  private detach(window: Window): void {
    const cleanup = this.windows.get(window);
    if (!cleanup) return;
    cleanup();
    this.windows.delete(window);
    if (this.active === window) this.active = undefined;
    if (!this.active && this.groupActive && !this.disposed) {
      this.groupActive = false;
      this.options.onLeaveGroup?.();
    }
  }

  private setActive(window: Window): void {
    if (this.disposed || !this.windows.has(window)) return;
    if (this.transitionTimer !== undefined)
      this.clearTimer(this.transitionTimer);
    this.transitionTimer = undefined;
    this.active = window;
    if (!this.groupActive) {
      this.groupActive = true;
      this.options.onEnterGroup?.();
    }
  }
}

/** Keeps native-window shortcuts local and prevents Backspace navigation. */
export function installManagedCardWindowKeyboard(
  window: Window,
  close: () => void,
): () => void {
  const onKeyDown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "w"
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      const target = event.target as Element | null;
      if (target?.closest?.("input,textarea,[contenteditable='true'],select"))
        return;
      event.preventDefault();
    }
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
