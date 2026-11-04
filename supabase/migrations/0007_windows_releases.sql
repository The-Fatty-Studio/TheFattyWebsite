-- Windows builds: releases get a platform, and each platform has its own current release and version numbers.
alter table public.releases
  add column platform text not null default 'android' check (platform in ('android', 'windows'));

alter table public.releases drop constraint releases_version_key;
alter table public.releases add constraint releases_platform_version_key unique (platform, version);

drop index public.releases_one_current;
create unique index releases_one_current_per_platform on public.releases (platform) where is_current;

-- The dashboard's per-version breakdown now tells a Windows download apart from an Android one.
create or replace function public.download_analytics(p_days integer default 30)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select greatest(1, least(p_days, 365)) as n,
           date_trunc('day', now() at time zone 'utc') as last_day
  ),
  ev as (
    select e.ts, e.country, e.device, e.ua_family, e.referrer, e.ip_hash,
           coalesce(r.version || case when r.platform = 'windows' then ' (Windows)' else '' end, 'unknown') as version,
           date_trunc('day', e.ts at time zone 'utc') as day
    from public.download_events e
    left join public.releases r on r.id = e.release_id
    cross join bounds b
    where e.ts at time zone 'utc' >= b.last_day - make_interval(days => b.n - 1)
  ),
  per_day as (
    select day, count(*) as downloads, count(distinct ip_hash) as visitors
    from ev group by day
  ),
  days as (
    select s.d as day
    from bounds b, generate_series(b.last_day - make_interval(days => b.n - 1), b.last_day, interval '1 day') as s(d)
  )
  select jsonb_build_object(
    'days', (select n from bounds),
    'total', (select count(*) from ev),
    'visitor_days', (select coalesce(sum(visitors), 0) from per_day),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD'),
        'downloads', coalesce(p.downloads, 0),
        'visitors', coalesce(p.visitors, 0)) order by d.day), '[]'::jsonb)
      from days d left join per_day p on p.day = d.day),
    'by_version', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'downloads', n) order by n desc, label), '[]'::jsonb)
      from (select version as label, count(*) as n from ev group by 1 order by n desc limit 10) t),
    'by_country', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'downloads', n) order by n desc, label), '[]'::jsonb)
      from (select coalesce(country, 'Unknown') as label, count(*) as n from ev group by 1 order by n desc limit 10) t),
    'by_device', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'downloads', n) order by n desc, label), '[]'::jsonb)
      from (select coalesce(device, 'other') as label, count(*) as n from ev group by 1 order by n desc limit 10) t),
    'by_browser', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'downloads', n) order by n desc, label), '[]'::jsonb)
      from (select coalesce(ua_family, 'other') as label, count(*) as n from ev group by 1 order by n desc limit 10) t),
    'by_referrer', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'downloads', n) order by n desc, label), '[]'::jsonb)
      from (select coalesce(referrer, 'Direct') as label, count(*) as n from ev group by 1 order by n desc limit 10) t),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ts', ts, 'country', country, 'device', device, 'browser', ua_family,
        'referrer', referrer, 'version', version) order by ts desc), '[]'::jsonb)
      from (select * from ev order by ts desc limit 20) t)
  );
$$;

revoke execute on function public.download_analytics(integer) from public, anon, authenticated;
grant execute on function public.download_analytics(integer) to service_role;
