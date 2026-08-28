"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rz-chain-reporter/ui/components/dropdown-menu";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link, useRouter } from "@/i18n/navigation";
import { signOutAction } from "../actions/auth-actions";
import { authClient } from "../lib/auth-client";

type SessionUser = (typeof authClient.$Infer.Session)["user"];

export type UserMenuUser = Pick<SessionUser, "id" | "name" | "email">;

export default function UserMenu({ user }: { user: UserMenuUser | null }) {
  const router = useRouter();
  const t = useTranslations(SHARED_NAMESPACE);
  const {
    data: session,
    error,
    isPending,
    isRefetching,
  } = authClient.useSession();
  const refreshedDivergence = useRef<string | null>(null);
  const clientUserId = session?.user.id ?? null;
  const serverUserId = user?.id ?? null;

  useEffect(() => {
    if (isPending || isRefetching || error) return;

    if (clientUserId === serverUserId) {
      refreshedDivergence.current = null;
      return;
    }

    const divergence = JSON.stringify([serverUserId, clientUserId]);
    if (refreshedDivergence.current === divergence) return;

    refreshedDivergence.current = divergence;
    router.refresh();
  }, [clientUserId, error, isPending, isRefetching, router, serverUserId]);

  if (!user) {
    return (
      <Button
        className="max-sm:min-h-11"
        nativeButton={false}
        render={<Link href="/login" />}
        variant="outline"
      >
        {t("userMenu.signIn")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="min-w-0 max-w-48 max-sm:min-h-11"
            suppressHydrationWarning
            variant="outline"
          />
        }
      >
        <span className="sm:hidden">{t("userMenu.account")}</span>
        <span className="hidden min-w-0 truncate sm:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-w-[calc(100vw-1rem)] bg-card"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("userMenu.account")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="whitespace-normal break-words text-foreground">
            {user.name}
          </DropdownMenuLabel>
          <DropdownMenuLabel className="whitespace-normal break-all font-normal">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              const [error] = await signOutAction();
              if (error) return;
              authClient.$store.notify("$sessionSignal");
              router.push("/");
            }}
          >
            {t("userMenu.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
