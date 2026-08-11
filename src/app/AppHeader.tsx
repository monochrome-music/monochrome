import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';

export function AppHeader() {
    return (
        <>
            <div className="navigation-controls desktop-only">
                <button aria-label="Go back" className="nav-btn" id="nav-back" title="Go back" type="button">
                    <Icon svg={icons.chevronLeft} />
                </button>
                <button aria-label="Go forward" className="nav-btn" id="nav-forward" title="Go forward" type="button">
                    <Icon svg={icons.chevronRight} />
                </button>
            </div>

            <button
                aria-label="Open navigation"
                className="hamburger-menu"
                id="hamburger-btn"
                title="Open navigation"
                type="button"
            >
                <Icon svg={icons.menu} />
            </button>

            <form className="search-bar" id="search-form" role="search">
                <Icon className="search-icon" svg={icons.search} />
                <label className="sr-only" htmlFor="search-input">
                    Search music
                </label>
                <input
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    id="search-input"
                    placeholder="Search music"
                    spellcheck={false}
                    type="search"
                />
                <button
                    aria-label="Clear search"
                    className="search-clear-btn btn-icon"
                    style={{ display: 'none' }}
                    title="Clear search"
                    type="button"
                >
                    <span aria-hidden="true">×</span>
                </button>
                <div
                    aria-label="Search history"
                    className="search-history"
                    id="search-history"
                    style={{ display: 'none' }}
                />
            </form>

            <div className="header-account-control">
                <button aria-label="Account" className="btn-icon" id="header-account-btn" title="Account" type="button">
                    <span className="header-account-icon-wrap" id="header-account-icon">
                        <Icon svg={icons.user} />
                    </span>
                    <img
                        alt="Account avatar"
                        crossOrigin="anonymous"
                        id="header-account-img"
                        referrerPolicy="no-referrer"
                        style={{ display: 'none' }}
                    />
                </button>
                <div className="dropdown-menu" id="header-account-dropdown" />
            </div>
        </>
    );
}
