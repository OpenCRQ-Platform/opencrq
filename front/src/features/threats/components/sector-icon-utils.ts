import { foldText } from '@app/utils/text-fold';
import {
  Banknote,
  Briefcase,
  Building2,
  Clapperboard,
  Cpu,
  Droplets,
  Factory,
  FlaskConical,
  Globe,
  GraduationCap,
  HeartPulse,
  Hotel,
  Landmark,
  Newspaper,
  Pickaxe,
  Plane,
  RadioTower,
  Scale,
  Shield,
  ShoppingCart,
  Truck,
  Users,
  Wheat,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** For a sector no rule recognizes: OpenCTI's sector list is open, so any name can arrive. */
export const DEFAULT_SECTOR_ICON: LucideIcon = Building2;

// The first rule whose stem starts a word of the folded name wins, so a more specific rule comes
// before a broader one that would also match ("hospitality" before "hospital").
const SECTOR_ICON_RULES: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  // A non-governmental organization is civil society, not government.
  [/(?<!non[- ])\b(?:government|administration|public sector|municipal|parliament|politic|election)/, Landmark],
  [/\b(?:diploma|international|embass|foreign affairs)/, Globe],
  [/\b(?:defen[cs]e|military|armed forces|weapon)/, Shield],
  [/\b(?:judicia|justice|legal|law)/, Scale],
  [/\b(?:financ|bank|insur|payment|crypto|investment|fintech)/, Banknote],
  [/\b(?:water)/, Droplets],
  [/\b(?:energ|oil|gas\b|electric|nuclear|power|petrol|fuel|utilit)/, Zap],
  [/\b(?:hospitality|hotel|touris|travel|restaurant)/, Hotel],
  [/\b(?:health|hospital|medic|pharma|biotech)/, HeartPulse],
  [/\b(?:educat|universit|school|academ)/, GraduationCap],
  [/\b(?:research|scien|think tank)/, FlaskConical],
  [/\b(?:telecom|communication)/, RadioTower],
  [/\b(?:technolog|software|computer|cyber|digital|internet|semiconductor|electronic)/, Cpu],
  [/\b(?:media|press|news|broadcast|journalis|publishing)/, Newspaper],
  [/\b(?:cultur|entertainment|sport|gaming|arts\b)/, Clapperboard],
  [/\b(?:transport|aviation|aerospace|airline|airport|maritime|shipping|rail|automotive)/, Plane],
  [/\b(?:logistic|postal|delivery|supply chain)/, Truck],
  [/\b(?:agricultur|agribusiness|food|farm)/, Wheat],
  [/\b(?:mining|metal)/, Pickaxe],
  [/\b(?:manufactur|industr|chemical|construction|engineering)/, Factory],
  [/\b(?:retail|commerce|consumer)/, ShoppingCart],
  [/\b(?:consult|professional services)/, Briefcase],
  [/\b(?:civil society|non-?profit|ngo|non[- ]?governmental|association|religio)/, Users],
];

export const sectorIcon = (sectorName: string): LucideIcon => {
  const folded = foldText(sectorName);
  return SECTOR_ICON_RULES.find(([pattern]) => pattern.test(folded))?.[1] ?? DEFAULT_SECTOR_ICON;
};
