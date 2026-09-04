import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "./text";
import { Field } from "./field";
import { Input, Textarea } from "./input";
import { Select, MultiSelect } from "./select";
import { Combobox } from "./combobox";
import { Checkbox, Radio, RadioGroup, Switch } from "./choice";
import { Slider } from "./slider";
import { DatePicker, DateRangePicker, type DateRange } from "./date-picker";
import { TimezonePicker } from "./timezone-picker";
import { CronInput } from "./cron-input";
import { KeyValueEditor, type KeyValuePair } from "./key-value-editor";
import { CodeEditor } from "./code-editor";
import { TagInput } from "./tag-input";

/**
 * FORMS — every control, every state, both themes.
 *
 * The resting state of a text control is a SUNKEN surface, so an input reads as
 * a slot cut into the panel rather than a card floating on it. That is what
 * makes a dense config form scan as a form.
 */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      {hint ? <Text variant="caption" tone="muted" className="mt-1 mb-3 block max-w-[76ch]">{hint}</Text> : <div className="mb-3" />}
      <div className="bg-surface-raised border-subtle rounded-lg border p-4">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

const REGIONS = [
  { value: "us-east-1", label: "us-east-1", description: "N. Virginia" },
  { value: "us-west-2", label: "us-west-2", description: "Oregon" },
  { value: "eu-west-1", label: "eu-west-1", description: "Ireland" },
  { value: "ap-south-1", label: "ap-south-1", description: "Mumbai" },
  { value: "sa-east-1", label: "sa-east-1", description: "São Paulo", disabled: true },
];

/** 600 options — past the virtualisation threshold, so the menu mounts ~12 rows. */
const MANY = Array.from({ length: 600 }, (_, i) => ({
  value: `tool_${i}`,
  label: `tool_${String(i).padStart(4, "0")}`,
  description: i % 3 === 0 ? "http · GET" : i % 3 === 1 ? "postgres · read" : "slack · post",
}));

const meta = { title: "Primitives/Forms", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Forms: Story = { render: () => <FormsGallery /> };

function FormsGallery() {
  const [text, setText] = React.useState("renewals-daily");
  const [multi, setMulti] = React.useState<string[]>(["us-east-1", "eu-west-1"]);
  const [combo, setCombo] = React.useState<string | null>("tool_0042");
  const [tags, setTags] = React.useState(["production", "billing"]);
  const [kv, setKv] = React.useState<KeyValuePair[]>([
    { key: "Authorization", value: "Bearer sk-live-…", secret: true },
    { key: "Content-Type", value: "application/json" },
  ]);
  const [json, setJson] = React.useState('{\n  "workflow": "renewals",\n  "retries": 3,\n  "notify": true\n}');
  const [cron, setCron] = React.useState("*/5 * * * *");
  const [tz, setTz] = React.useState<string | null>("Europe/London");
  const [date, setDate] = React.useState<Date | null>(new Date());
  const [range, setRange] = React.useState<DateRange>({ start: null, end: null });
  const [concurrency, setConcurrency] = React.useState([8]);
  const [budget, setBudget] = React.useState([20, 80]);
  const [live, setLive] = React.useState(true);

  return (
    <div className="font-ui p-8">
      <Text variant="eyebrow" tone="accent" className="mb-2 block">Primitives</Text>
      <Text variant="display-md" tone="max" className="mb-2">Forms</Text>
      <Text variant="body-sm" tone="secondary" className="mb-8 block max-w-[76ch]">
        Errors render adjacent to their field, never only at the top of the form. The Field wrapper
        owns id generation, aria-describedby and aria-invalid, so a control cannot be mis-wired.
      </Text>

      <Section title="Field — label, description, error, counter" hint="Required is marked with a glyph AND a screen-reader word; colour alone never carries meaning.">
        <Grid>
          <Field label="Workflow name" description="Lowercase, hyphens only." required
            characterCount={{ value: text.length, max: 40 }}>
            <Input value={text} onChange={(e) => setText(e.target.value)} />
          </Field>

          <Field label="Workflow name" required
            error="Names cannot contain spaces. Use hyphens instead.">
            <Input defaultValue="renewals daily" />
          </Field>

          <Field label="Workflow name" description="This field is disabled." disabled>
            <Input defaultValue="renewals-daily" disabled />
          </Field>
        </Grid>
      </Section>

      <Section title="Input" hint="Adornments are absolutely positioned, so text never reflows when a spinner arrives.">
        <Grid>
          <Field label="Plain"><Input placeholder="Search runs…" /></Field>
          <Field label="With prefix"><Input prefix={<span className="text-caption">https://</span>} placeholder="hooks.example.com" /></Field>
          <Field label="With suffix"><Input suffix={<span className="text-caption">ms</span>} defaultValue="30000" mono /></Field>
          <Field label="Validating (loading)"><Input defaultValue="renewals-daily" loading /></Field>
          <Field label="Invalid" error="That host is unreachable. Check DNS or try another region.">
            <Input defaultValue="bad host" />
          </Field>
          <Field label="Mono / tabular"><Input mono defaultValue="a35d65ca-9f21-4c7e" /></Field>
        </Grid>
      </Section>

      <Section title="Textarea" hint="Auto-grows between minRows and maxRows. Height is set, never transitioned.">
        <Grid>
          <Field label="Description" description="Grows as you type.">
            <Textarea placeholder="What does this workflow do?" minRows={3} maxRows={8} />
          </Field>
          <Field label="Disabled"><Textarea disabled defaultValue="Locked." /></Field>
          <Field label="Invalid" error="Description is required before publishing.">
            <Textarea />
          </Field>
        </Grid>
      </Section>

      <Section title="Select · MultiSelect · Combobox" hint="Combobox virtualises past 40 rows — the list below has 600 and mounts about twelve.">
        <Grid>
          <Field label="Region"><Select options={REGIONS} placeholder="Choose a region" /></Field>
          <Field label="Region (disabled)"><Select options={REGIONS} disabled placeholder="Choose a region" /></Field>
          <Field label="Region (invalid)" error="Pick a region to continue.">
            <Select options={REGIONS} placeholder="Choose a region" />
          </Field>
          <Field label="Regions" description="Multiple.">
            <MultiSelect options={REGIONS} value={multi} onValueChange={setMulti} noun="regions" />
          </Field>
          <Field label="Tool" description="600 options, virtualised.">
            <Combobox options={MANY} value={combo} onValueChange={setCombo} />
          </Field>
          <Field label="Tool (async)" description="Debounced remote search.">
            <Combobox
              onSearch={async (q) => {
                await new Promise((r) => setTimeout(r, 400));
                return MANY.filter((o) => o.label.includes(q)).slice(0, 50);
              }}
              placeholder="Type to search remotely…"
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Checkbox · Radio · Switch" hint="Control and label are one hit target. A switch applies immediately; if it needs saving it is a checkbox.">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="grid gap-2">
            <Text variant="label" tone="secondary">Checkbox</Text>
            <Checkbox defaultChecked description="Retry from the last checkpoint.">Resume on failure</Checkbox>
            <Checkbox>Unchecked</Checkbox>
            <Checkbox checked="indeterminate">Indeterminate</Checkbox>
            <Checkbox disabled>Disabled</Checkbox>
            <Checkbox disabled defaultChecked>Disabled checked</Checkbox>
          </div>

          <div className="grid gap-2">
            <Text variant="label" tone="secondary">Radio</Text>
            <RadioGroup defaultValue="all">
              <Radio value="all" description="Every node, from the top.">Full replay</Radio>
              <Radio value="failed">Failed nodes only</Radio>
              <Radio value="locked" disabled>Requires approval</Radio>
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Text variant="label" tone="secondary">Switch</Text>
            <Switch checked={live} onCheckedChange={setLive} description="Applies immediately.">
              Live tail
            </Switch>
            <Switch defaultChecked>On</Switch>
            <Switch>Off</Switch>
            <Switch disabled>Disabled</Switch>
            <Switch disabled defaultChecked>Disabled on</Switch>
          </div>
        </div>
      </Section>

      <Section title="Slider" hint="Always paired with a tabular readout — a slider without one is unusable for a value you have to justify later.">
        <Grid>
          <Field label="Concurrency"><Slider value={concurrency} onValueChange={setConcurrency} min={1} max={32} step={1} unit="×" /></Field>
          <Field label="Budget band"><Slider value={budget} onValueChange={setBudget} min={0} max={100} step={5} unit="%" /></Field>
          <Field label="Disabled"><Slider defaultValue={[40]} disabled unit="%" /></Field>
        </Grid>
      </Section>

      <Section title="Dates" hint="Today is always dotted, even when another day is selected. Weekends dim. Presets first — that is what gets used.">
        <Grid>
          <Field label="Start date"><DatePicker value={date} onValueChange={setDate} /></Field>
          <Field label="Window"><DateRangePicker value={range} onValueChange={setRange} /></Field>
          <Field label="Timezone" description="Offsets computed live from Intl.">
            <TimezonePicker value={tz} onValueChange={setTz} />
          </Field>
        </Grid>
      </Section>

      <Section title="CronInput" hint="Prose translation plus the next five fire times. Preview height is fixed, so typing never moves the form below it.">
        <div className="max-w-md">
          <Field label="Schedule" description="Five fields, standard cron.">
            <CronInput value={cron} onValueChange={setCron} timezone={tz ?? undefined} />
          </Field>
        </div>
      </Section>

      <Section title="TagInput · KeyValueEditor" hint="Rows are keyed by stable id, not array index — editing the first key must not blur every row beneath it.">
        <Grid>
          <Field label="Tags" description="Enter or comma to commit.">
            <TagInput value={tags} onValueChange={setTags} />
          </Field>
          <div className="xl:col-span-2">
            <Field label="Request headers" description="Values can be marked secret.">
              <KeyValueEditor value={kv} onValueChange={setKv} allowSecret />
            </Field>
          </div>
        </Grid>
      </Section>

      <Section title="CodeEditor" hint="Highlighted layer beneath a transparent textarea, so caret, selection, undo and IME stay native. Formats on blur; invalid JSON is never silently reformatted.">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Node input"><CodeEditor value={json} onValueChange={setJson} aria-label="Node input JSON" /></Field>
          <Field label="Invalid example">
            <CodeEditor value={'{ "retries": 3,, }'} onValueChange={() => {}} aria-label="Invalid JSON" />
          </Field>
        </div>
      </Section>
    </div>
  );
}
