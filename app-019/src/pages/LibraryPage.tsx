// 榫卯知识卡：角度、配合余量经验值
import knowledge from '../data/knowledge.json'

export function LibraryPage() {
  return (
    <div className="page" data-testid="library-page">
      <h1>榫卯知识卡</h1>
      <p className="note">以下均为木工经验值（非标准规范），供参考；配合余量表可在编辑器中编辑。</p>
      <div className="knowledge-grid">
        {knowledge.cards.map((c) => (
          <article key={c.title} className="knowledge-card" data-testid="knowledge-card">
            <h2>{c.title}</h2>
            <p>{c.body}</p>
            <div className="tags">
              {c.tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
