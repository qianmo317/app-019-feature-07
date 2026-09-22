import { useRoute } from './router'
import { HomePage } from './pages/HomePage'
import { NewPlanPage } from './pages/NewPlanPage'
import { EditorPage, PrintPage } from './pages/EditorPage'
import { LibraryPage } from './pages/LibraryPage'
import { navigate } from './router'

export function App() {
  const route = useRoute()
  return (
    <div className="app">
      <nav className="nav no-print">
        <button className="nav-brand" onClick={() => navigate('/')}>木工榫卯参数化图纸</button>
        <div className="nav-links">
          <button className="nav-link" data-testid="nav-home" onClick={() => navigate('/')}>方案</button>
          <button className="nav-link" data-testid="nav-new" onClick={() => navigate('/new')}>新建</button>
          <button className="nav-link" data-testid="nav-library" onClick={() => navigate('/library')}>知识卡</button>
        </div>
      </nav>
      {route.name === 'home' && <HomePage onImported={() => undefined} />}
      {route.name === 'new' && <NewPlanPage />}
      {route.name === 'editor' && <EditorPage id={route.id} />}
      {route.name === 'print' && <PrintPage id={route.id} />}
      {route.name === 'library' && <LibraryPage />}
    </div>
  )
}
