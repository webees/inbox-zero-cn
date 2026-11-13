"use client";

import clsx from "clsx";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Image from "next/image";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import { Card, CardContent } from "@/components/new-landing/common/Card";
import {
  Paragraph,
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";
import { userCount } from "@/utils/config";
import { BRAND_NAME } from "@/utils/branding";

type Testimonial = {
  body: MessageDescriptor;
  author: {
    name: string;
    handle: string;
    imageUrl: string;
  };
};

const featuredTestimonial: Testimonial = {
  body: msg`到目前为止很喜欢！只用了几分钟就清理掉了最碍眼的新闻邮件和促销邮件订阅。`,
  author: {
    name: "Jonni Lundy",
    handle: "Resend",
    imageUrl: "/images/testimonials/jonnilundy.jpg",
  },
};

const stevenTestimonial: Testimonial = {
  body: msg`喜欢 @elie2222 的这个新开源应用：getinboxzero.com`,
  author: {
    name: "Steven Tey",
    handle: "Dub",
    imageUrl: "/images/testimonials/steventey.jpg",
  },
};

const vinayTestimonial: Testimonial = {
  body: msg`这正是我找了很久的东西——感谢开发它。`,
  author: {
    name: "Vinay Katiyar",
    handle: "@ktyr",
    imageUrl:
      "https://ph-avatars.imgix.net/2743360/28744c72-2267-49ed-999d-5bdab677ec28?auto=compress&codec=mozjpeg&cs=strip&auto=format&w=120&h=120&fit=crop&dpr=2",
  },
};

const yoniTestimonial: Testimonial = {
  body: msg`哇。仅用 3 分钟就完成引导流程，并开始退订最烦人的垃圾邮件发送者……谢谢 🙏🏼`,
  author: {
    name: "Yoni Belson",
    handle: "LeadTrap",
    imageUrl: "/images/testimonials/yoni.jpeg",
  },
};

const slimTestimonial: Testimonial = {
  body: msg`我是在积极寻找虚拟助理来管理邮件时发现 Inbox Zero 的，试用之后发现它彻底改变了我的工作方式。`,
  author: {
    name: "Slim Labassi",
    handle: "Boomgen",
    imageUrl: "/images/testimonials/slim.png",
  },
};

const willTestimonial: Testimonial = {
  body: msg`我喜欢它的灵活性和自定义选项，这是很久以来第一个真正让我的收件箱变得井然有序的工具。谢谢！`,
  author: {
    name: "Will Brierly",
    handle: "DreamKey",
    imageUrl: "/images/testimonials/will.jpeg",
  },
};

const valentineTestimonial: Testimonial = {
  body: msg`我是一名高管，每天被数百封邮件淹没，非常依赖行政助理来管理邮件。我最喜欢 Inbox Zero 的地方，是它无缝取代了这一整套职能——智能自动化、优先级排序和组织功能，就像把我的工作流程中内置了一位专属邮件助理。`,
  author: {
    name: "Valentine Nwachukwu",
    handle: "Zaden Technologies",
    imageUrl: "/images/testimonials/valentine.png",
  },
};

const joelTestimonial: Testimonial = {
  body: msg`我试过很多工具，这是第一个能在其起草的回复中真正体现我说话风格的工具。`,
  author: {
    name: "Joel Neuenhaus",
    handle: "Outbound Legal",
    imageUrl: "/images/testimonials/joel.jpeg",
  },
};

const alexTestimonial: Testimonial = {
  body: msg`超级期待这个！做得好，我肯定会用起来——我一直在等这样的工具，把它作为电子邮件的上层工具实在太合理了。`,
  author: {
    name: "Alex Bass",
    handle: "Efficient App",
    imageUrl:
      "https://ph-avatars.imgix.net/3523155/original?auto=compress&codec=mozjpeg&cs=strip&auto=format&w=120&h=120&fit=crop&dpr=2",
  },
};

const jamesTestimonial: Testimonial = {
  body: msg`嘿兄弟，你的工具真的就是我找了很久的东西哈哈。简直是天赐之物`,
  author: {
    name: "James",
    handle: "@james",
    imageUrl: "/images/testimonials/midas-hofstra-a6PMA5JEmWE-unsplash.jpg",
  },
};

const steveTestimonial: Testimonial = {
  body: msg`我主要是希望让我的收件箱不再那么混乱。邮件越堆越多，我经常遗漏本该处理的待办事项。到目前为止它真的很有帮助。`,
  author: {
    name: "Steve Radabaugh",
    handle: "@stevenpaulr",
    imageUrl: "/images/home/testimonials/steve-rad.png",
  },
};

const wilcoTestimonial: Testimonial = {
  body: msg`终于有一个“退订应用”能让你*真正*退订，并使用 Gmail 过滤器进行筛选（而不是一直依赖第三方应用来筛选这些邮件）。这对我来说是很大的加分项，因为我的所有过滤器都在同一个地方（也就是 Gmail 过滤器里）。做得太棒了！我已经是粉丝了 :)`,
  author: {
    name: "Wilco de Kreij",
    handle: "@emarky",
    imageUrl:
      "https://ph-avatars.imgix.net/28450/8c4c8039-003a-4b3f-80ec-7035cedb6ac3?auto=compress&codec=mozjpeg&cs=strip&auto=format&w=120&h=120&fit=crop&dpr=2",
  },
};

const desktopTestimonials: Testimonial[][][] = [
  [
    [stevenTestimonial, joelTestimonial, willTestimonial, vinayTestimonial],
    [slimTestimonial, alexTestimonial],
  ],
  [
    [valentineTestimonial, steveTestimonial],
    [yoniTestimonial, wilcoTestimonial, jamesTestimonial],
  ],
];

const mobileTestimonials: Testimonial[] = [
  joelTestimonial,
  valentineTestimonial,
  stevenTestimonial,
  yoniTestimonial,
  slimTestimonial,
  alexTestimonial,
  willTestimonial,
];

export function Testimonials() {
  return (
    <Section>
      <SectionHeading wrap>
        <Trans>加入 {userCount} 位在邮件上花费更少时间的用户</Trans>
      </SectionHeading>
      <SectionSubtitle>
        <Trans>我们的客户喜欢用 {BRAND_NAME} 节省时间。</Trans>
      </SectionSubtitle>
      <SectionContent>
        {/* Mobile */}
        <div className="grid gap-4 text-sm leading-6 text-gray-900 sm:hidden">
          {mobileTestimonials.map((testimonial) => (
            <TestimonialCard
              testimonial={testimonial}
              key={testimonial.author.name}
            />
          ))}
        </div>

        {/* Desktop */}
        <div className="hidden grid-cols-1 grid-rows-1 gap-8 text-sm leading-6 text-gray-900 sm:grid sm:grid-cols-2 xl:grid-flow-col xl:grid-cols-4">
          <TestimonialCard
            testimonial={featuredTestimonial}
            className="sm:col-span-2 xl:col-start-2 xl:row-end-1"
            variant="featured"
          />
          {desktopTestimonials.map((columnGroup, columnGroupIdx) => (
            <div
              key={columnGroupIdx}
              className="space-y-8 xl:contents xl:space-y-0"
            >
              {columnGroup.map((column, columnIdx) => (
                <div
                  key={columnIdx}
                  className={clsx(
                    (columnGroupIdx === 0 && columnIdx === 0) ||
                      (columnGroupIdx === desktopTestimonials.length - 1 &&
                        columnIdx === columnGroup.length - 1)
                      ? "xl:row-span-2"
                      : "xl:row-start-1",
                    "space-y-8",
                  )}
                >
                  {column.map((testimonial) => (
                    <TestimonialCard
                      testimonial={testimonial}
                      key={testimonial.author.handle}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </SectionContent>
    </Section>
  );
}

function TestimonialCard({
  testimonial,
  variant = "default",
  className,
}: {
  testimonial: Testimonial;
  className?: string;
  variant?: "default" | "featured";
}) {
  const { i18n } = useLingui();
  const body = i18n._(testimonial.body);

  return (
    <Card key={testimonial.author.handle} className={className}>
      <CardContent>
        {variant === "featured" ? (
          <Paragraph
            color="gray-700"
            size="lg"
            className="font-semibold leading-7 tracking-tight"
          >
            {body}
          </Paragraph>
        ) : (
          <Paragraph size="md" color="gray-500">
            {body}
          </Paragraph>
        )}
      </CardContent>
      <CardContent className="border-t border-[#F3F3F3] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Image
            className="size-14 md:size-10 rounded-full bg-gray-50 border-2 border-[#E3E3E3]"
            src={testimonial.author.imageUrl}
            alt={testimonial.author.name}
            width={100}
            height={100}
          />
          <div className="text-left">
            <Paragraph size="md" color="dark" className="font-semibold">
              {testimonial.author.name}
            </Paragraph>
            {testimonial.author.handle ? (
              <Paragraph size="md">{testimonial.author.handle}</Paragraph>
            ) : undefined}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
