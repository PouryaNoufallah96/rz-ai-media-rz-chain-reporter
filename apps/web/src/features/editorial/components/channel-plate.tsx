import { Bdi } from "@rz-chain-reporter/ui/components/bdi";

export function ChannelPlate({ handle }: { handle: string }) {
  return (
    <span className="inline-flex shrink-0 border border-foreground px-1 font-mono text-[11px] leading-5">
      <Bdi dir="ltr" translate="no">{`@${handle}`}</Bdi>
    </span>
  );
}
