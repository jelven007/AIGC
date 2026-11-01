import HeroSection from './HeroSection';

interface LandingHeroProps { onGoToApp: () => void; onScrollToPromo?: () => void }
export default function LandingHero({ onGoToApp, onScrollToPromo }: LandingHeroProps) {
  return <HeroSection onGoToApp={onGoToApp} onScrollToPromo={onScrollToPromo} />;
}
