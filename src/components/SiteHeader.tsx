export default function SiteHeader({ page }: { page: 'home' | 'dex' | 'battle' | 'league' }) {
  return <header className="site-header">
    <a href="#home" className="brand" aria-label="Pokémon Battle Simulator home"><span className="brand-ball" aria-hidden="true" /><span>POKÉMON<strong>BATTLE LEAGUE</strong></span></a>
    <nav aria-label="Main navigation"><a href="#home" aria-current={page === 'home' ? 'page' : undefined}><small>01</small> Home</a><a href="#pokemon/pikachu" aria-current={page === 'dex' ? 'page' : undefined}><small>02</small> Pokédex</a><a href="#battle" aria-current={page === 'battle' ? 'page' : undefined}><small>03</small> Battle</a><a href="#league" aria-current={page === 'league' ? 'page' : undefined}><small>04</small> Online</a></nav>
    <span className="header-note"><i /> YOUR ROAD TO THE LEAGUE</span>
  </header>;
}
