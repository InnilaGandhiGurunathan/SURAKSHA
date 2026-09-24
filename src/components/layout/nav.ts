import {
  Activity,
  Bell,
  BookOpen,
  Compass,
  LayoutDashboard,
  PhoneCall,
  Settings,
  ShieldAlert,
  Users,
  UserCircle2,
  MapPinned,
} from 'lucide-react';
import type { Role } from '@/domain/types';

export interface NavItem {
  to: string;
  label: string;
  /** Shorter label for the narrow mobile bottom bar. */
  short?: string;
  icon: typeof LayoutDashboard;
  /** Shown in the mobile bottom bar (max 4 + a More sheet). */
  mobile?: boolean;
  end?: boolean;
}

export const TRAVELLER_NAV: NavItem[] = [
  { to: '/traveller', label: 'Home', icon: LayoutDashboard, mobile: true, end: true },
  { to: '/traveller/journey', label: 'Journey', icon: Compass, mobile: true },
  { to: '/traveller/exit', label: 'Exit Mode', short: 'Exit', icon: PhoneCall, mobile: true },
  { to: '/traveller/circle', label: 'Trusted Circle', short: 'Circle', icon: Users, mobile: true },
  { to: '/traveller/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/traveller/community', label: 'Community', icon: MapPinned },
  { to: '/traveller/learn', label: 'Learn', icon: BookOpen },
  { to: '/traveller/profile', label: 'Profile', icon: UserCircle2 },
];

export const GUARDIAN_NAV: NavItem[] = [
  { to: '/guardian', label: 'Overview', icon: LayoutDashboard, mobile: true, end: true },
  { to: '/guardian/journeys', label: 'Active Journeys', short: 'Journeys', icon: Activity, mobile: true },
  { to: '/guardian/alerts', label: 'Alerts', icon: Bell, mobile: true },
  { to: '/guardian/incidents', label: 'Incidents', short: 'Records', icon: ShieldAlert, mobile: true },
  { to: '/guardian/contacts', label: 'Trusted Contacts', icon: Users },
  { to: '/guardian/settings', label: 'Settings', icon: Settings },
];

export function navForRole(role: Role): NavItem[] {
  return role === 'guardian' ? GUARDIAN_NAV : TRAVELLER_NAV;
}

export function homeForRole(role: Role): string {
  return role === 'guardian' ? '/guardian' : '/traveller';
}
