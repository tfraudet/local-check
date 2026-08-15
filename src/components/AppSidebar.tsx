import { useEffect, useState } from 'react';
import { Plane, Settings, Sun, Moon, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

import { SettingsPanel } from './SettingsPanel';
import { FlightPanel } from './FlightPanel';
import { useTheme } from './theme-provider';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

// Served from `public/`, so it keeps a stable, unhashed URL.
const logoAcph = `${import.meta.env.BASE_URL}logo-acph.jpg`;

type NavKey = 'flight' | 'theme' | 'settings' | 'help';

interface AppSidebarProps {
  onOpenHelp: () => void
}
 
export function AppSidebar({ onOpenHelp }: AppSidebarProps) {
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState<NavKey>('flight');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPanelOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPanelOpen]);

  const navItems: { key: NavKey; label: string, icon: typeof Plane }[] = [
    { key: 'flight', label:  t('upload.title') , icon: Plane},
    { key: 'settings', label: t('settings.title'), icon: Settings },
    { key: 'help', label: t('help.title'), icon: Info },
  ];

  function handleNavClick(key: NavKey): void {
    if (key === 'help') {
      setIsPanelOpen(false);
      setActiveNav(key);
      onOpenHelp();
      return;
    }

    if (key === activeNav) {
      setIsPanelOpen((open) => !open);
      return;
    }

    setActiveNav(key);
    setIsPanelOpen(true);
  }

  return (
    <>
    {/* ── Panel 1: icon-only navigation ─────────────────────────────── */}
    <Sidebar
      collapsible="none"
      className="relative z-30 h-[calc(100svh)] w-[calc(var(--sidebar-width-icon)+6px)]! border-r"
      onClick={(event) => event.stopPropagation()}
    >
      <SidebarHeader>
        {/* <House /> */}
        <a
          href="https://aeroclub-issoire.fr"
          target="_blank"
          rel="noreferrer"
          aria-label="Visit Aero Club Issoire website"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar size="lg">
            <AvatarImage src={logoAcph} alt="ACPH logo" />
            <AvatarFallback>ACPH Logo</AvatarFallback>
          </Avatar>
        </a>

      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  tooltip={{ children: item.label, hidden: false }}
                  onClick={() => handleNavClick(item.key)}
                  isActive={activeNav === item.key}
                >
                  <item.icon />
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={{
                children: t(
                  theme === 'dark'
                    ? 'theme.switchToLight'
                    : 'theme.switchToDark',
                ),
                hidden: false,
              }}
              size="default"
              onClick={toggleTheme}
            >
            {theme === 'dark' ? (
              <Sun  />
            ) : (
              <Moon  />
            )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>

   { /* ── Panel 2: contextual content ───────────────────────────────── */}
    {isPanelOpen && (
      <Sidebar
        collapsible="none"
        className="relative z-30 border-r"
        onClick={(event) => event.stopPropagation()}
      >
        <SidebarHeader className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {navItems.find((item) => item.key === activeNav)?.label ?? ''}
          </h2>
        </SidebarHeader>
        <SidebarContent>
          {activeNav === 'flight' && <FlightPanel />}
          {activeNav === 'settings' && <SettingsPanel />}
        </SidebarContent>
      </Sidebar>
    )}

    </>
  )
}
