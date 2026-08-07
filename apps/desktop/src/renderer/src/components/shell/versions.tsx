import type { ElectronVersions } from "@/shared/ipc/bridge";

interface VersionsProps {
  versions: ElectronVersions;
}

const Versions = ({ versions }: VersionsProps) => {
  const { chrome, electron, node } = versions;

  return (
    <ul className="flex list-disc items-center gap-5 p-2 text-xs opacity-45">
      <li className="electron-version">Electron v{electron}</li>
      <li className="chrome-version">Chromium v{chrome}</li>
      <li className="node-version">Node v{node}</li>
    </ul>
  );
};

export default Versions;
