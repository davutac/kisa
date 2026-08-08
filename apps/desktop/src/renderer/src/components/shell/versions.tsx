import { APP_NAME } from "@/constants";
import type { ElectronVersions } from "@/shared/ipc/bridge";

interface VersionsProps {
  versions: ElectronVersions;
}

const Versions = ({ versions }: VersionsProps) => {
  const { app, chrome, electron, node } = versions;

  return (
    <ul className="flex list-disc items-center justify-center gap-5 p-2 text-xs opacity-45">
      <li className="app-version">
        {APP_NAME} v{app}
      </li>
      <li className="electron-version">Electron v{electron}</li>
      <li className="chrome-version">Chromium v{chrome}</li>
      <li className="node-version">Node v{node}</li>
    </ul>
  );
};

export default Versions;
