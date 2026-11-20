import { describe, expect, it } from 'vitest';
import {
  Banknote,
  Briefcase,
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
  Truck,
  Users,
  Wheat,
  Zap,
} from 'lucide-react';
import { DEFAULT_SECTOR_ICON, sectorIcon } from './sector-icon-utils';

describe('sectorIcon', () => {
  it.each([
    ['Agriculture and agribusiness', Wheat],
    ['Civil society', Users],
    ['Consulting', Briefcase],
    ['Culture and entertainment', Clapperboard],
    ['Defense', Shield],
    ['Diplomacy', Globe],
    ['Education', GraduationCap],
    ['Energy', Zap],
    ['Finance', Banknote],
    ['Government and administrations', Landmark],
    ['Health', HeartPulse],
    ['Hospitality', Hotel],
    ['Judicial power (justice)', Scale],
    ['Logistics', Truck],
    ['Manufacturing', Factory],
    ['Mining', Pickaxe],
    ['Research', FlaskConical],
    ['Technologies', Cpu],
    ['Telecommunications', RadioTower],
    ['Transport', Plane],
    ['Water distribution and supply', Droplets],
  ])('gives the OpenCTI sector "%s" its own icon', (name, icon) => {
    expect(sectorIcon(name)).toBe(icon);
  });

  it.each([
    ['Banking', Banknote],
    ['Oil and gas', Zap],
    ['Pharmaceuticals', HeartPulse],
    ['Aviation', Plane],
    ['Media', Newspaper],
    ['Think tanks', FlaskConical],
    ['International organizations', Globe],
  ])('recognizes the sub-sector "%s"', (name, icon) => {
    expect(sectorIcon(name)).toBe(icon);
  });

  it('reads the name without case or accents', () => {
    expect(sectorIcon('ÉNERGIE')).toBe(sectorIcon('energie'));
    expect(sectorIcon('Défense')).toBe(Shield);
  });

  it.each(['Non-governmental organizations', 'Non-Governmental Organisations', 'Non governmental organizations'])('gives "%s" the civil society icon, not the government one', (name) => {
    expect(sectorIcon(name)).toBe(Users);
  });

  it('tells hospitality apart from health', () => {
    expect(sectorIcon('Hospitals')).toBe(HeartPulse);
    expect(sectorIcon('Hospitality')).toBe(Hotel);
  });

  it('only matches a stem at the start of a word', () => {
    expect(sectorIcon('Startups')).toBe(DEFAULT_SECTOR_ICON);
  });

  it.each(['Unknown', 'Something else entirely', ''])('falls back to the default icon for "%s"', (name) => {
    expect(sectorIcon(name)).toBe(DEFAULT_SECTOR_ICON);
  });
});
