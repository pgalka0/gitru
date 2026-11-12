import { Git, Inbox, Issue, PullRequest } from "@gitru/icon";
import { TooltipProvider } from "@gitru/ui/components/tooltip";
import { GithubAccountButton } from "@/components/github/github-account-button";
import SideBarItems from "./items";

const Sidebar = () => {
  return (
    <div className="flex flex-col justify-between items-center -mr-2 ml-0.5">
      <div className="w-full flex flex-col items-center">
        <TooltipProvider>
          <div className="flex flex-col items-center gap-1">
            <SideBarItems
              items={[
                {
                  icon: Inbox,
                  name: "Inbox",
                  href: "/app/inbox",
                },
                {
                  icon: PullRequest,
                  name: "Pull requests",
                  href: "/app/pulls",
                },
                {
                  icon: Issue,
                  name: "Issues",
                  href: "/app/issues",
                },
                {
                  icon: Git,
                  name: "Local Git",
                  href: "/app/git",
                },
              ]}
            />
          </div>
        </TooltipProvider>
      </div>

      <div className="flex flex-col items-center gap-1 pb-1">
        <GithubAccountButton />
      </div>
    </div>
  );
};

export default Sidebar;
