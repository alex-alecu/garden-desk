import type { DropIntent } from "../desktop-drop.js";
import { Icon } from "./icons.js";

const labels: Record<DropIntent, string> = {
  checking: "Drop files or folders",
  files: "Drop files to attach",
  folders: "Drop folders to add workspaces",
  mixed: "Drop to add files and folders",
};

export function DropOverlay({ intent }: { intent: DropIntent | undefined }) {
  if (intent === undefined) return null;
  const showsFiles = intent !== "folders";
  const showsFolders = intent !== "files";
  return (
    <div aria-live="polite" className={`drop-overlay drop-overlay-${intent}`} role="status">
      <section className="drop-overlay-card">
        <div aria-hidden="true" className="drop-overlay-icons">
          {showsFiles ? (
            <span className="drop-overlay-icon drop-overlay-file">
              <Icon name="add" />
            </span>
          ) : null}
          {showsFolders ? (
            <span className="drop-overlay-icon drop-overlay-folder">
              <Icon name="folder" />
            </span>
          ) : null}
        </div>
        <h2>{labels[intent]}</h2>
        <p>Release anywhere</p>
      </section>
    </div>
  );
}
