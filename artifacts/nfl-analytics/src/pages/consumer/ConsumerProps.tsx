import { getGetConsumerPropsAvailabilityQueryKey, useGetConsumerPropsAvailability } from '@workspace/api-client-react';
import { LockKeyhole } from 'lucide-react';
import { ConsumerLoading } from './consumer-ui';

export default function ConsumerProps() {
  const query = useGetConsumerPropsAvailability({ query: { queryKey: getGetConsumerPropsAvailabilityQueryKey(), staleTime: 300_000 } });
  if (query.isLoading) return <ConsumerLoading />;
  return <div className="consumer-page"><div className="consumer-props"><LockKeyhole /><p className="consumer-eyebrow">Unavailable</p><h1>Player props</h1><p>{query.data?.message ?? 'Player props are not available in this version of Gridline.'}</p></div></div>;
}