alter table public.app_settings add column if not exists required_documents jsonb not null default '[]';

create or replace view public.dealer_stats as
select d.id as dealer_id,
  count(dl.id) as total_deals,
  count(dl.id) filter (where dl.status = 'funded') as funded_deals,
  count(dl.id) filter (where dl.status not in ('funded','declined')) as active_deals,
  case when count(dl.id) filter (where dl.status in ('funded','approved','declined')) > 0
    then round(100.0 * count(dl.id) filter (where dl.status in ('funded','approved'))
      / count(dl.id) filter (where dl.status in ('funded','approved','declined')), 1)
    else 0 end as approval_rate
from public.dealers d left join public.deals dl on dl.dealer_id = d.id
group by d.id;