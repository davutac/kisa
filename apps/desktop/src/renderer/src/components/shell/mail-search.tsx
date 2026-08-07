import { useLocation, useNavigate } from "@tanstack/react-router";
import { SearchIcon, XIcon } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useMailboxStore, useSelectedAccountId } from "@/state/mailbox";

const TitlebarMailSearch = () => {
  const searchQuery = useMailboxStore((state) => state.searchQuery);
  const setSearchQuery = useMailboxStore((state) => state.setSearchQuery);
  const selectedAccountId = useSelectedAccountId();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const showMailbox = (): void => {
    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  };

  return (
    <InputGroup className="app-titlebar-interactive bg-muted/50 h-7 w-64 border-transparent shadow-none">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search email"
        onChange={(event) => {
          setSearchQuery(event.target.value);
          showMailbox();
        }}
        onFocus={showMailbox}
        placeholder={
          selectedAccountId === null
            ? "Search all accounts"
            : "Search this account"
        }
        value={searchQuery}
      />
      {searchQuery.length > 0 ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label="Clear search"
            onClick={() => {
              setSearchQuery("");
            }}
            size="icon-xs"
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
};

export default TitlebarMailSearch;
