/**
 * Lightweight stand-ins for Base UI overlays (menu, popover, dialogs). The
 * real ones position and animate their popups, which takes seconds per
 * interaction in jsdom. Use with:
 *
 *   vi.mock("@gitru/ui/components/menu", async () =>
 *     (await import("./mocks/ui-overlays")).menuModule);
 */
import {
  type ComponentProps,
  cloneElement,
  createContext,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";

interface OpenState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

type RenderProp = ReactElement<{
  onClick?: MouseEventHandler<HTMLButtonElement>;
}>;

/** A trigger whose `render` element toggles the surrounding overlay. */
function makeTrigger(context: React.Context<OpenState | null>) {
  return function Trigger({
    children,
    render,
  }: {
    children: ReactNode;
    render: RenderProp;
  }) {
    const state = useContext(context);
    if (!state) throw new Error("Trigger outside its overlay");
    return cloneElement(
      render,
      {
        onClick: (event) => {
          render.props.onClick?.(event);
          state.setOpen(!state.open);
        },
      },
      children,
    );
  };
}

/** Controlled when `open` is passed, like the real components. */
function makeRoot(context: React.Context<OpenState | null>) {
  return function Root({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) {
    const [internal, setInternal] = useState(false);
    const value = open ?? internal;
    return (
      <context.Provider
        value={{
          open: value,
          setOpen: (next) => {
            if (open === undefined) setInternal(next);
            onOpenChange?.(next);
          },
        }}
      >
        {children}
      </context.Provider>
    );
  };
}

function makePopup(context: React.Context<OpenState | null>, role: string) {
  return function Popup({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) {
    const state = useContext(context);
    if (!state?.open) return null;
    return (
      <div
        role={role}
        className={className}
        onKeyDown={(event) => {
          if (event.key === "Escape") state.setOpen(false);
        }}
      >
        {children}
      </div>
    );
  };
}

const Div = ({ children, className }: ComponentProps<"div">) => (
  <div className={className}>{children}</div>
);
const Heading = ({ children, className }: ComponentProps<"h2">) => (
  <h2 className={className}>{children}</h2>
);
const Paragraph = ({ children, className }: ComponentProps<"p">) => (
  <p className={className}>{children}</p>
);

// Menu ----------------------------------------------------------------------

const MenuContext = createContext<OpenState | null>(null);

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  variant?: string;
}) {
  const state = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        state?.setOpen(false);
      }}
    >
      {children}
    </button>
  );
}

function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
}: {
  children: ReactNode;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {children}
    </button>
  );
}

const RadioContext = createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
}>({});

export const menuModule = {
  Menu: makeRoot(MenuContext),
  MenuTrigger: makeTrigger(MenuContext),
  MenuPopup: makePopup(MenuContext, "menu"),
  MenuItem,
  MenuCheckboxItem,
  MenuSeparator: () => <hr />,
  MenuGroup: Div,
  MenuGroupLabel: Div,
  MenuRadioGroup: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <RadioContext.Provider value={{ value, onValueChange }}>
      {children}
    </RadioContext.Provider>
  ),
  MenuRadioItem: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) => {
    const group = useContext(RadioContext);
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={group.value === value}
        onClick={() => group.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  },
};

// Popover -------------------------------------------------------------------

const PopoverContext = createContext<OpenState | null>(null);

export const popoverModule = {
  Popover: makeRoot(PopoverContext),
  PopoverTrigger: makeTrigger(PopoverContext),
  PopoverPopup: makePopup(PopoverContext, "dialog"),
  PopoverTitle: Heading,
  PopoverDescription: Paragraph,
};

// Dialogs -------------------------------------------------------------------

function makeClose(context: React.Context<OpenState | null>) {
  return function Close({
    children,
    render,
    onClick,
  }: {
    children: ReactNode;
    render: RenderProp;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) {
    const state = useContext(context);
    return cloneElement(
      render,
      {
        onClick: (event) => {
          render.props.onClick?.(event);
          onClick?.(event);
          state?.setOpen(false);
        },
      },
      children,
    );
  };
}

const AlertDialogContext = createContext<OpenState | null>(null);

export const alertDialogModule = {
  AlertDialog: makeRoot(AlertDialogContext),
  AlertDialogTrigger: makeTrigger(AlertDialogContext),
  AlertDialogPopup: makePopup(AlertDialogContext, "alertdialog"),
  AlertDialogHeader: Div,
  AlertDialogFooter: Div,
  AlertDialogTitle: Heading,
  AlertDialogDescription: Paragraph,
  AlertDialogClose: makeClose(AlertDialogContext),
};

const DialogContext = createContext<OpenState | null>(null);

export const dialogModule = {
  Dialog: makeRoot(DialogContext),
  DialogTrigger: makeTrigger(DialogContext),
  DialogPopup: makePopup(DialogContext, "dialog"),
  DialogHeader: Div,
  DialogFooter: Div,
  DialogTitle: Heading,
  DialogDescription: Paragraph,
  DialogClose: makeClose(DialogContext),
};
