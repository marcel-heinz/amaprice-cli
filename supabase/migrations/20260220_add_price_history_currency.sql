-- Ensure price history stores currency code per row.
-- Run this migration in Supabase SQL Editor.

alter table public.price_history
  add column if not exists currency text;

-- Normalize blank values to NULL before backfill.
update public.price_history
set currency = null
where trim(coalesce(currency, '')) = '';

-- Backfill missing currency from known Amazon domain defaults.
update public.price_history ph
set currency = case
  when p.domain = 'amazon.de' then 'EUR'
  when p.domain = 'amazon.com' then 'USD'
  when p.domain = 'amazon.co.uk' then 'GBP'
  when p.domain = 'amazon.fr' then 'EUR'
  when p.domain = 'amazon.it' then 'EUR'
  when p.domain = 'amazon.es' then 'EUR'
  when p.domain = 'amazon.nl' then 'EUR'
  when p.domain = 'amazon.co.jp' then 'JPY'
  when p.domain = 'amazon.ca' then 'CAD'
  when p.domain = 'amazon.com.au' then 'AUD'
  when p.domain = 'amazon.in' then 'INR'
  when p.domain = 'amazon.com.br' then 'BRL'
  else ph.currency
end
from public.products p
where ph.product_id = p.id
  and ph.currency is null;
