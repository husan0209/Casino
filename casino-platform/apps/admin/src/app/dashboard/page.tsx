export default function Dashboard(){
  const cards = [
    ['Пользователи','12 450','+150'],
    ['Депозиты','125 000 ₽','+23 000'],
    ['Выводы','45 000 ₽','+12 000'],
    ['GGR','80 000 ₽','+18 000'],
  ]
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Дашборд</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(([t,v,d])=>(
          <div key={t} className="bg-[#141420] rounded-2xl p-4 border border-white/5">
            <div className="text-sm text-[#8b8ba7]">{t}</div>
            <div className="text-2xl font-bold mt-1">{v}</div>
            <div className="text-xs text-emerald-400">{d} сегодня</div>
          </div>
        ))}
      </div>
      <div className="bg-[#141420] rounded-2xl p-4 border border-white/5">
        <div className="text-sm text-[#8b8ba7]">Графики / события — Часть 6</div>
      </div>
    </div>
  )
}
