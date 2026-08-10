import { useEffect, useState } from 'react';
import { House, Plane, Settings } from 'lucide-react';
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

type NavKey = 'flight' | 'settings';
 
export function AppSidebar() {
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState<NavKey>('flight');
  const [isPanelOpen, setIsPanelOpen] = useState(false);

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
  ];

   const footerItems: { key: NavKey; label: string, icon: typeof Plane }[] = [
    { key: 'settings', label: t('settings.title'), icon: Settings },
  ];

  function handleNavClick(key: NavKey): void {
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
      className="relative z-30 h-[calc(100svh)] w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
      onClick={(event) => event.stopPropagation()}
    >
      <SidebarHeader>
        <House />
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
                  className="pl-2!"
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
          {footerItems.map((item) => (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton
                tooltip={{ children: item.label, hidden: false }}
                onClick={() => handleNavClick(item.key)}
                isActive={activeNav === item.key}
                className="pl-2!"
              >
                <item.icon />
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
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
            {navItems.find((item) => item.key === activeNav)?.label ?? footerItems.find((item) => item.key === activeNav)?.label}
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
