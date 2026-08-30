import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';
import { useEffect, useState } from 'preact/hooks';

interface NavigationItem {
    id: string;
    href: string;
    label: string;
    icon: string;
    target?: '_blank';
    hidden?: boolean;
}

const primaryItems: NavigationItem[] = [
    { id: 'sidebar-nav-home', href: '/', label: 'Home', icon: icons.house },
    { id: 'sidebar-nav-library', href: '/library', label: 'Library', icon: icons.library },
    { id: 'sidebar-nav-recent', href: '/recent', label: 'Recent', icon: icons.recent },
    { id: 'sidebar-nav-unreleased', href: '/unreleased', label: 'Unreleased', icon: icons.squares },
    { id: 'sidebar-nav-donate', href: '/donate', label: 'Donate', icon: icons.handHeart },
    { id: 'sidebar-nav-settings', href: '/settings', label: 'Settings', icon: icons.settings },
];

const secondaryItems: NavigationItem[] = [
    { id: 'sidebar-nav-about-bottom', href: '/about', label: 'About', icon: icons.info },
    { id: 'sidebar-nav-mobile', href: '/mobile', label: 'Mobile', icon: icons.smartphone },
    { id: 'sidebar-nav-discordbtn', href: 'discord.html', label: 'Discord', icon: icons.discord, target: '_blank' },
    { id: 'sidebar-nav-party', href: '/parties', label: 'Parties', icon: icons.users },
    {
        id: 'sidebar-nav-githubbtn',
        href: 'https://github.com/monochrome-music/monochrome',
        label: 'GitHub',
        icon: icons.github,
        target: '_blank',
        hidden: true,
    },
];

function isCurrentPath(pathname: string, href: string) {
    if (href === '/') return pathname === '/' || pathname === '/home';
    return href.startsWith('/') && (pathname === href || pathname.startsWith(`${href}/`));
}

function usePathname() {
    const [pathname, setPathname] = useState(() => window.location.pathname);

    useEffect(() => {
        const update = () => setPathname(window.location.pathname);
        window.addEventListener('popstate', update);
        return () => window.removeEventListener('popstate', update);
    }, []);

    return pathname;
}

function NavigationList({ items, pathname }: { items: NavigationItem[]; pathname: string }) {
    return (
        <ul>
            {items.map((item) => {
                const active = isCurrentPath(pathname, item.href);
                return (
                    <li
                        className={`nav-item${active ? ' active' : ''}`}
                        id={item.id}
                        key={item.id}
                        style={item.hidden ? { display: 'none' } : undefined}
                    >
                        <a
                            aria-current={active ? 'page' : undefined}
                            href={item.href}
                            id={item.id === 'sidebar-nav-party' ? 'sidebar-party-btn' : undefined}
                            rel={item.target ? 'noreferrer' : undefined}
                            target={item.target}
                        >
                            <Icon svg={item.icon} size={item.id === 'sidebar-nav-discordbtn' ? 22 : 20} />
                            <span>{item.label}</span>
                        </a>
                        {item.id === 'sidebar-nav-donate' ? (
                            <div className="sidebar-donate-goal" id="sidebar-donate-goal-container">
                                <div className="sidebar-donate-goal-track">
                                    <div className="sidebar-donate-goal-fill" id="sidebar-donate-goal-progress" />
                                </div>
                                <span id="sidebar-donate-goal-text">0%</span>
                            </div>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

export function AppNavigation() {
    const pathname = usePathname();

    return (
        <>
            <div className="sidebar-logo">
                <a aria-label="Monochrome home" className="sidebar-logo-link" href="/">
                    <Icon className="app-logo" svg={icons.logo} size={22} />
                    <span>Monochrome</span>
                </a>
                <button
                    aria-label="Collapse sidebar"
                    className="btn-icon desktop-only"
                    id="sidebar-toggle"
                    title="Collapse sidebar"
                    type="button"
                >
                    <Icon svg={icons.chevronLeft} />
                </button>
            </div>

            <nav aria-label="Primary" className="sidebar-nav main">
                <NavigationList items={primaryItems} pathname={pathname} />
            </nav>

            <div className="sidebar-bottom-container">
                <nav
                    aria-label="Pinned music"
                    className="sidebar-nav"
                    id="pinned-items-nav"
                    style={{ display: 'none' }}
                >
                    <h2 className="pinned-items-header">Pinned</h2>
                    <ul id="pinned-items-list" />
                </nav>

                <div className="sidebar-nav-bottom">
                    <nav aria-label="More" className="sidebar-nav bottom">
                        <NavigationList items={secondaryItems} pathname={pathname} />
                    </nav>
                </div>
            </div>
        </>
    );
}
