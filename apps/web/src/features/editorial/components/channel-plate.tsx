import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";

export function ChannelPlate({ handle }: { handle: string }) {
  return (
    <Badge className="shrink-0 font-normal" variant="secondary">
      <Bdi dir="ltr" translate="no">{`@${handle}`}</Bdi>
    </Badge>
  );
}
