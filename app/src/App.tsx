import { useRoute } from './app/router';
import { SessionProvider } from './app/session';
import { Header, Banners, Footer } from './ui/Layout';
import { Home } from './ui/screens/Home';
import { Sources } from './ui/screens/Sources';
import { ImportCsv } from './ui/screens/ImportCsv';
import { Reader } from './ui/screens/Reader';
import { Themes } from './ui/screens/Themes';
import { Findings, FindingEditor } from './ui/screens/Findings';
import { Report } from './ui/screens/Report';
import { Settings } from './ui/screens/Settings';
import { Help } from './ui/screens/Help';
import { Search } from './ui/screens/Search';
import { NotFound } from './ui/screens/Misc';

function Routes() {
  const r = useRoute();
  const demo = 'kind' in r && r.kind === 'd';
  let body;
  switch (r.name) {
    case 'home':
      body = <Home />;
      break;
    case 'settings':
      body = <Settings />;
      break;
    case 'help':
      body = <Help />;
      break;
    case 'sources':
      body = <Sources key={r.pid} kind={r.kind} pid={r.pid} />;
      break;
    case 'importCsv':
      body = <ImportCsv key={r.pid} kind={r.kind} pid={r.pid} />;
      break;
    case 'reader':
      body = <Reader key={r.sid} kind={r.kind} pid={r.pid} sid={r.sid} ex={r.ex} />;
      break;
    case 'themes':
      body = <Themes key={r.pid} kind={r.kind} pid={r.pid} />;
      break;
    case 'findings':
      body = <Findings key={r.pid} kind={r.kind} pid={r.pid} />;
      break;
    case 'findingEdit':
      body = <FindingEditor key={r.fid} kind={r.kind} pid={r.pid} fid={r.fid} />;
      break;
    case 'report':
      body = <Report key={r.pid} kind={r.kind} pid={r.pid} />;
      break;
    case 'search':
      body = <Search key={r.pid} kind={r.kind} pid={r.pid} />;
      break;
    default:
      body = <NotFound />;
  }
  return (
    <>
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        本文へ移動
      </button>
      <Header />
      <Banners demo={demo} />
      {body}
      <Footer />
    </>
  );
}

export function App() {
  return (
    <SessionProvider
      fallback={
        <>
          <Header />
          <p className="loading" role="status">
            読み込み中…
          </p>
        </>
      }
      onFatal={(e) => (
        <>
          <Header />
          <main className="container page">
            <div className="notice notice-error" role="alert">
              <div>
                <p>
                  <strong>{e.title}</strong>
                </p>
                <p>{e.message}</p>
              </div>
            </div>
          </main>
        </>
      )}
    >
      <Routes />
    </SessionProvider>
  );
}
