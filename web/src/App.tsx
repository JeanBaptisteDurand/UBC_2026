import { useEffect, useState } from "react";
import Layout from "./Layout";
import { useHashRoute, type RouteId } from "./routes";
import { useLang } from "./i18n";
import Overview from "./screens/Overview";
import Hive from "./screens/Hive";
import Products from "./screens/Products";
import Bounties from "./screens/Bounties";
import Playground from "./screens/Playground";
import Keys from "./screens/Keys";
import PostBounty from "./screens/PostBounty";
import Operator from "./screens/Operator";
import Publish from "./screens/Publish";
import Wallet from "./screens/Wallet";
import Developers from "./screens/Developers";
import FloatingCopilot from "./screens/FloatingCopilot";

function Page({ route, go }: { route: RouteId; go: (r: string) => void }) {
  switch (route) {
    case "vue": return <Overview go={go} />;
    case "ruche": return <Hive />;
    case "produits": return <Products go={go} />;
    case "primes": return <Bounties go={go} />;
    case "playground": return <Playground go={go} />;
    case "cles": return <Keys />;
    case "publier-prime": return <PostBounty />;
    case "operateur": return <Operator go={go} />;
    case "publier-produit": return <Publish />;
    case "portefeuille": return <Wallet go={go} />;
    case "developpeurs": return <Developers />;
  }
}

export default function App() {
  // the language is read here: changing it redraws the whole app (without unmounting pages or losing their state)
  useLang();
  const [route, go] = useHashRoute();
  const [copilotOpen, setCopilotOpen] = useState(false);
  // ⌘K / Ctrl+K opens or closes the copilot from any page
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCopilotOpen((v) => !v); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return (
    <>
      <Layout route={route} go={go} onOpenCopilot={() => setCopilotOpen(true)}>
        <Page route={route} go={go} />
      </Layout>
      <FloatingCopilot onNavigate={go} open={copilotOpen} setOpen={setCopilotOpen} />
    </>
  );
}
