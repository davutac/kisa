import {
  DatabaseIcon,
  PlusIcon,
  Settings2Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import AccountProviderIcon from "@/components/accounts/account-provider-icon";
import { openAccountSetup } from "@/components/accounts/open-account-setup";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSearch,
  createCommandController,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DialogController } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { getHotkeyDisplay, useAppCommand, useHotkeyLayer } from "@/hotkeys";
import { cn } from "@/lib/utils";
import { getRuntimeCapabilities } from "@/platform/desktop";
import { useAccounts } from "@/state/accounts";

import SettingsAccountPage from "./settings-account-page";
import SettingsAiPage from "./settings-ai-page";
import SettingsDataPage from "./settings-data-page";
import SettingsGeneralPage from "./settings-general-page";
import {
  APP_SETTINGS_PAGE_LABELS as PAGE_LABELS,
  getSettingsPageLabel,
  isSettingsPage,
  listSettingsPages,
  resolveSettingsPage,
  toAccountSettingsPage,
} from "./settings-pages";
import type { SettingsPage } from "./settings-pages";
import { buildSettingsSearchIndex, searchSettings } from "./settings-search";
import { SettingsSearchTargetContext } from "./settings-search-target";

// Each panel scrolls itself, so a new page starts at its top. Positioned,
// so the hidden native inputs of its switches scroll with it.
const panelClassName =
  "scroll-fade-y relative min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-12 md:px-10";

const [SEARCH_KEY] = getHotkeyDisplay("settings.focusSearch").bindings;

interface SettingsDialogBodyProps {
  readonly navRef: React.RefObject<HTMLDivElement | null>;
  readonly onSelectPage: (page: SettingsPage) => void;
  readonly selectedPage: SettingsPage;
}

/**
 * What the open dialog shows. It mounts with each opening, so a search starts
 * empty every time, while the page is kept by the dialog around it.
 */
const SettingsDialogBody = ({
  navRef,
  onSelectPage,
  selectedPage,
}: SettingsDialogBodyProps) => {
  const {
    accounts: accountsApi,
    ai,
    appSettings,
    loginItemSettings,
    mail,
    settings,
    updates,
    window: windowApi,
  } = getRuntimeCapabilities();

  const accounts = useAccounts();
  const settingsAccounts = accountsApi === undefined ? [] : accounts;

  const pages = listSettingsPages({
    accountIds: settingsAccounts.map(({ email }) => email),
    hasAi: ai !== undefined,
    hasData: settings !== undefined,
  });

  const page = resolveSettingsPage(selectedPage, pages);
  const bodyRef = useRef<HTMLDivElement>(null);
  const search = useInstanceValue(createCommandController);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const isSearching = query.trim().length > 0;

  const results = searchSettings(
    buildSettingsSearchIndex({
      accounts: settingsAccounts,
      hasAi: ai !== undefined,
      hasAppSettings: appSettings !== undefined,
      hasLoginItem: loginItemSettings !== undefined,
      hasMail: mail !== undefined,
      hasSettings: settings !== undefined,
      hasUpdates: updates !== undefined,
      hasWindow: windowApi !== undefined,
    }),
    query
  );

  useHotkeyLayer("settings", true);
  useAppCommand("settings.focusSearch", () => search.focus(), {
    layer: bodyRef,
  });

  const onReach = useCallback((reached: string): void => {
    setTarget(null);
    setHighlighted(reached);
  }, []);

  const onLeave = useCallback((left: string): void => {
    setHighlighted((current) => (current === left ? null : current));
  }, []);

  const searchTarget = useMemo(
    () => ({ highlighted, onLeave, onReach, target }),
    [highlighted, onLeave, onReach, target]
  );

  const showResult = (id: string): void => {
    const result = results.find((item) => item.id === id);

    if (result === undefined) {
      return;
    }

    onSelectPage(result.page);
    setQuery("");
    setHighlighted(null);
    setTarget(result.target);
  };

  return (
    <SettingsSearchTargetContext.Provider value={searchTarget}>
      <Tabs
        className="min-h-0 min-w-0 flex-1 gap-0"
        onValueChange={(value) => {
          if (isSettingsPage(value, pages)) {
            onSelectPage(value);
          }
        }}
        orientation="vertical"
        ref={bodyRef}
        value={page}
      >
        <div
          className="bg-sidebar flex w-56 shrink-0 flex-col gap-2 border-r p-2 pt-3"
          ref={navRef}
        >
          <Command
            autoHighlight
            className={cn(
              "h-auto shrink-0 gap-1 rounded-none bg-transparent p-0",
              isSearching && "min-h-0 flex-1"
            )}
            controller={search}
            filter={false}
            onAction={showResult}
            onQueryChange={setQuery}
            query={query}
          >
            <CommandSearch className="bg-background dark:bg-input/30 mx-0 mt-0 border">
              <CommandInput
                aria-label="Search settings"
                className="text-[13px]"
                placeholder="Search"
              />
              {isSearching ? null : (
                <Kbd aria-hidden="true" className="shrink-0">
                  {SEARCH_KEY}
                </Kbd>
              )}
            </CommandSearch>
            {isSearching ? (
              <CommandEmpty className="text-muted-foreground px-2 text-[13px]">
                No settings match
              </CommandEmpty>
            ) : null}
            <CommandList
              className="max-h-none min-h-0 flex-1"
              hidden={!isSearching}
            >
              {results.map((result) => (
                <CommandItem
                  className="min-h-8 text-[13px]"
                  key={result.id}
                  value={result.id}
                >
                  <span className="min-w-0 truncate">{result.title}</span>
                  {result.target === null ? null : (
                    <>
                      {" "}
                      <span className="text-muted-foreground ml-auto min-w-0 shrink truncate text-xs">
                        {getSettingsPageLabel(result.page)}
                      </span>
                    </>
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Command>

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto",
              isSearching && "hidden"
            )}
          >
            <TabsList aria-label="Sections">
              <TabsTab value="general">
                <Settings2Icon aria-hidden="true" />
                {PAGE_LABELS.general}
              </TabsTab>
              {ai === undefined ? null : (
                <TabsTab value="ai">
                  <SparklesIcon aria-hidden="true" />
                  {PAGE_LABELS.ai}
                </TabsTab>
              )}
              {settings === undefined ? null : (
                <TabsTab value="data">
                  <DatabaseIcon aria-hidden="true" />
                  {PAGE_LABELS.data}
                </TabsTab>
              )}
              {settingsAccounts.length === 0 ? null : (
                // The account tabs name themselves by address; the heading
                // only groups them for the eye, as a tablist holds only tabs.
                <div
                  aria-hidden="true"
                  className="text-muted-foreground px-2 pt-4 pb-1 text-xs font-medium"
                >
                  Accounts
                </div>
              )}
              {settingsAccounts.map((account) => (
                <TabsTab
                  key={account.email}
                  title={account.email}
                  value={toAccountSettingsPage(account.email)}
                >
                  <AccountProviderIcon
                    className="size-4"
                    provider={account.provider}
                  />
                  <span className="min-w-0 truncate">{account.email}</span>
                </TabsTab>
              ))}
            </TabsList>
            {accountsApi === undefined ? null : (
              <Button
                className="text-muted-foreground hover:text-foreground h-8 justify-start gap-2.5 px-2 text-[13px] font-normal"
                onClick={() => {
                  void openAccountSetup();
                }}
                type="button"
                variant="ghost"
              >
                <PlusIcon aria-hidden="true" />
                Add account
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-6 md:pl-10">
            <DialogTitle className="text-muted-foreground text-sm font-normal">
              Settings
            </DialogTitle>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <span className="min-w-0 truncate font-medium">
              {getSettingsPageLabel(page)}
            </span>
            <DialogClose
              aria-label="Close settings"
              render={
                <Button className="ml-auto" size="icon" variant="ghost" />
              }
            >
              <XIcon aria-hidden="true" />
            </DialogClose>
          </div>

          <TabsPanel className={panelClassName} value="general">
            <SettingsGeneralPage />
          </TabsPanel>
          {ai === undefined ? null : (
            <TabsPanel className={panelClassName} value="ai">
              <SettingsAiPage />
            </TabsPanel>
          )}
          {settings === undefined ? null : (
            <TabsPanel className={panelClassName} value="data">
              <SettingsDataPage
                appSettingsApi={appSettings}
                settingsApi={settings}
              />
            </TabsPanel>
          )}
          {accountsApi === undefined
            ? null
            : settingsAccounts.map((account) => (
                <TabsPanel
                  className={panelClassName}
                  key={account.email}
                  value={toAccountSettingsPage(account.email)}
                >
                  <SettingsAccountPage
                    account={account}
                    accountsApi={accountsApi}
                    mailApi={mail}
                    settingsApi={settings}
                  />
                </TabsPanel>
              ))}
        </div>
      </Tabs>
    </SettingsSearchTargetContext.Provider>
  );
};

/**
 * Settings, in a dialog over the window. A column of pages, General, AI
 * writing, Data and one per account, sits beside the selected page, under a
 * search that finds any page or setting and leads to it. The selected page is
 * kept while the window is open, so Settings reopens where it was left, and
 * only in memory, so a disconnected account's address isn't kept.
 */
const SettingsDialog = ({
  controller,
}: {
  readonly controller: DialogController;
}) => {
  const [selectedPage, setSelectedPage] = useState<SettingsPage>("general");
  const navRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog controller={controller}>
      <DialogContent
        className="bg-background flex h-[calc(100svh-2*(var(--app-titlebar-height)+0.75rem))] max-h-[54rem] w-[calc(100vw-3rem)] max-w-6xl gap-0 overflow-hidden p-0 text-sm [-webkit-app-region:no-drag] sm:max-w-6xl"
        // The selected page, so the arrows move between pages at once and
        // the search is a key away.
        initialFocus={() =>
          navRef.current?.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="true"]'
          )
        }
        showCloseButton={false}
      >
        <SettingsDialogBody
          navRef={navRef}
          onSelectPage={setSelectedPage}
          selectedPage={selectedPage}
        />
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
