import { DesktopCardWindowRegistry } from "../core/desktop-card-window-registry.ts";

const REGISTRY_STATE_KEY = "__zobDesktopWindowRegistryV1";

interface SharedRegistryState {
  profileInstanceId: string;
  registry: DesktopCardWindowRegistry;
  ownerIDs: WeakMap<Window, string>;
  ownerSequence: number;
}

type MainWindowWithRegistry = Window & {
  [REGISTRY_STATE_KEY]?: SharedRegistryState;
};

export interface DesktopRegistrationScope {
  vaultId: string;
  pairingEpoch: string;
}

export function desktopRegistrationOwner(window: Window): Window {
  try {
    return window.top ?? window;
  } catch {
    return Zotero.getMainWindow();
  }
}

export function getDesktopWindowRegistration(ownerWindow: Window): {
  owner: Window;
  registry: DesktopCardWindowRegistry;
  profileInstanceId: string;
  ownerWindowId: string;
} {
  const owner = desktopRegistrationOwner(ownerWindow);
  let mainWindow: MainWindowWithRegistry;
  try {
    mainWindow = Zotero.getMainWindow() as MainWindowWithRegistry;
  } catch {
    mainWindow = owner as MainWindowWithRegistry;
  }
  let state = mainWindow[REGISTRY_STATE_KEY];
  if (!state) {
    state = {
      profileInstanceId: `zotero-profile-${crypto.randomUUID()}`,
      registry: new DesktopCardWindowRegistry(),
      ownerIDs: new WeakMap<Window, string>(),
      ownerSequence: 0,
    };
    mainWindow[REGISTRY_STATE_KEY] = state;
  }
  let ownerWindowId = state.ownerIDs.get(owner);
  if (!ownerWindowId) {
    ownerWindowId = `zotero-window-${++state.ownerSequence}`;
    state.ownerIDs.set(owner, ownerWindowId);
  }
  return {
    owner,
    registry: state.registry,
    profileInstanceId: state.profileInstanceId,
    ownerWindowId,
  };
}

export function makeDesktopGroupIdentity(
  ownerWindow: Window,
  groupId: string,
  scope: DesktopRegistrationScope,
) {
  const registration = getDesktopWindowRegistration(ownerWindow);
  return {
    profileInstanceId: registration.profileInstanceId,
    ownerWindowId: registration.ownerWindowId,
    rootSessionId: groupId,
    groupId,
    vaultId: scope.vaultId,
    pairingEpoch: scope.pairingEpoch,
  };
}
