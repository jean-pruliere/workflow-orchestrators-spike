export const schema = `
create table if not exists task (
  id bigserial primary key,
  wf_id text not null,
  target text not null,
  type text not null,
  payload jsonb not null,
  status text not null default 'Pending',
  result jsonb,
  reason text,
  due_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_target_status_due on task (target, status, due_at);
`;
