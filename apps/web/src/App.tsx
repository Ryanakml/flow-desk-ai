import { useEffect, useState } from "react";
import { StatusBadge } from "@flowdesk/ui";
import type { BuildInfo } from "@flowdesk/contracts";
import { getBuildInfo } from "./api.js";
import "./styles.css";

export function App() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    void getBuildInfo()
      .then(setBuild)
      .catch(() => setError(true));
  }, []);
  return (
    <main>
      <p className="eyebrow">Execution foundation · M0</p>
      <h1>FlowDesk</h1>
      <p className="lede">
        The secure WhatsApp operations platform is being assembled from a verified foundation.
      </p>
      <section>
        <h2>Platform status</h2>
        <StatusBadge healthy={Boolean(build) && !error}>
          {build
            ? `API ${build.version} · ${build.gitSha}`
            : error
              ? "API unavailable"
              : "Checking API…"}
        </StatusBadge>
      </section>
    </main>
  );
}
