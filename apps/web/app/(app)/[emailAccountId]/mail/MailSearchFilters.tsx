"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildMailSearchQuery,
  DATE_WITHIN_OPTIONS,
  SEARCH_IN_OPTIONS,
  toCommonMailSearchFields,
  type MailSearchFields,
} from "@/app/(app)/[emailAccountId]/mail/mail-search-query";

export function MailSearchFiltersForm({
  initialFields,
  extraLocations = [],
  onSearch,
  variant = "gmail",
}: {
  initialFields: MailSearchFields;
  extraLocations?: { name: string }[];
  onSearch: (query: string) => void;
  /** 合并收件箱只共享两个服务商都能理解的运算符。 */
  variant?: "gmail" | "common";
}) {
  const isGmail = variant === "gmail";
  const [fields, setFields] = useState(initialFields);

  function update<Key extends keyof MailSearchFields>(
    key: Key,
    value: MailSearchFields[Key],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(
      buildMailSearchQuery(isGmail ? fields : toCommonMailSearchFields(fields)),
    );
  }

  return (
    <form aria-label="搜索选项" className="grid gap-3" onSubmit={handleSubmit}>
      <FilterField id="mail-search-from" label="发件人">
        <Input
          id="mail-search-from"
          value={fields.from}
          onChange={(event) => update("from", event.target.value)}
          className={mailControlClassName}
        />
      </FilterField>

      <FilterField id="mail-search-to" label="收件人">
        <Input
          id="mail-search-to"
          value={fields.to}
          onChange={(event) => update("to", event.target.value)}
          className={mailControlClassName}
        />
      </FilterField>

      <FilterField id="mail-search-subject" label="主题">
        <Input
          id="mail-search-subject"
          value={fields.subject}
          onChange={(event) => update("subject", event.target.value)}
          className={mailControlClassName}
        />
      </FilterField>

      <FilterField id="mail-search-has-words" label="包含词语">
        <Input
          id="mail-search-has-words"
          value={fields.hasWords}
          onChange={(event) => update("hasWords", event.target.value)}
          className={mailControlClassName}
        />
      </FilterField>

      <FilterField id="mail-search-doesnt-have" label="不包含">
        <Input
          id="mail-search-doesnt-have"
          value={fields.doesntHave}
          onChange={(event) => update("doesntHave", event.target.value)}
          className={mailControlClassName}
        />
      </FilterField>

      {isGmail ? (
        <>
          <FilterField id="mail-search-size" label="大小">
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_auto] items-center gap-2">
              <Select
                value={fields.sizeComparison}
                onValueChange={(value) =>
                  update(
                    "sizeComparison",
                    value === "less" ? "less" : "greater",
                  )
                }
              >
                <SelectTrigger
                  id="mail-search-size"
                  type="button"
                  aria-label="大小比较"
                  className={mailSelectTriggerClassName}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="greater">大于</SelectItem>
                  <SelectItem value="less">小于</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                aria-label="大小数值"
                value={fields.sizeValue}
                onChange={(event) => update("sizeValue", event.target.value)}
                className={mailControlClassName}
              />
              <Select
                value={fields.sizeUnit}
                onValueChange={(value) =>
                  update("sizeUnit", value === "KB" ? "KB" : "MB")
                }
              >
                <SelectTrigger
                  type="button"
                  aria-label="大小单位"
                  className={`${mailSelectTriggerClassName} w-20`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="KB">KB</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FilterField>

          <FilterField id="mail-search-date-within" label="日期范围">
            <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-2">
              <Select
                value={fields.dateWithin}
                onValueChange={(value) => {
                  const next = DATE_WITHIN_OPTIONS.find(
                    (option) => option.value === value,
                  );
                  if (next) update("dateWithin", next.value);
                }}
              >
                <SelectTrigger
                  id="mail-search-date-within"
                  type="button"
                  aria-label="日期范围"
                  className={mailSelectTriggerClassName}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_WITHIN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                aria-label="日期"
                value={fields.date}
                onChange={(event) => update("date", event.target.value)}
                className={mailControlClassName}
              />
            </div>
          </FilterField>

          <FilterField id="mail-search-in" label="搜索">
            <Select
              value={fields.searchIn}
              onValueChange={(value) => update("searchIn", value)}
            >
              <SelectTrigger
                id="mail-search-in"
                type="button"
                className={mailSelectTriggerClassName}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_IN_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.name}
                  </SelectItem>
                ))}
                {extraLocations.length ? (
                  <SelectGroup>
                    <SelectLabel>标签</SelectLabel>
                    {extraLocations.map((location) => (
                      <SelectItem
                        key={location.name}
                        value={`label:${location.name}`}
                      >
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
          </FilterField>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="mail-search-has-attachment"
                checked={fields.hasAttachment}
                onCheckedChange={(checked) =>
                  update("hasAttachment", checked === true)
                }
              />
              <Label
                htmlFor="mail-search-has-attachment"
                className="font-normal text-sm"
              >
                含附件
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="mail-search-exclude-chats"
                checked={fields.excludeChats}
                onCheckedChange={(checked) =>
                  update("excludeChats", checked === true)
                }
              />
              <Label
                htmlFor="mail-search-exclude-chats"
                className="font-normal text-sm"
              >
                不包含聊天
              </Label>
            </div>
          </div>
        </>
      ) : null}

      <div className="flex justify-end pt-1">
        <Button type="submit" variant="gradient" size="sm">
          搜索
        </Button>
      </div>
    </form>
  );
}

function FilterField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.25rem_minmax(0,1fr)] items-center gap-x-3">
      <Label htmlFor={id} className="font-normal text-muted-foreground text-sm">
        {label}
      </Label>
      {children}
    </div>
  );
}

const mailControlClassName = "h-8 text-xs";
const mailSelectTriggerClassName = "h-8 w-full text-xs";
