"use client";

import clsx from "clsx";
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
  body: string;
  author: {
    name: string;
    handle: string;
    imageUrl: string;
    logoUrl?: string;
  };
};

const featuredTestimonial = {
  body: "到目前为止非常喜欢！几分钟就清理掉了我最杂乱的一批简报和促销邮件订阅。",
  author: {
    name: "Jonni Lundy",
    handle: "Resend",
    imageUrl: "/images/testimonials/jonnilundy.jpg",
    logoUrl: "/images/logos/resend.svg",
  },
};

const stevenTestimonial: Testimonial = {
  body: "喜欢 @elie2222 的这款新开源应用：getinboxzero.com",
  author: {
    name: "Steven Tey",
    handle: "Dub",
    imageUrl: "/images/testimonials/steventey.jpg",
  },
};

const vinayTestimonial: Testimonial = {
  body: "这是我找了很久的东西 —— 感谢你把它做出来。",
  author: {
    name: "Vinay Katiyar",
    handle: "@ktyr",
    imageUrl:
      "https://ph-avatars.imgix.net/2743360/28744c72-2267-49ed-999d-5bdab677ec28?auto=compress&codec=mozjpeg&cs=strip&auto=format&w=120&h=120&fit=crop&dpr=2",
  },
};

const yoniTestimonial: Testimonial = {
  body: "哇。完成引导流程后，只用 3 分钟就开始退订最糟糕的垃圾邮件发送者了……谢谢你 🙏🏼",
  author: {
    name: "Yoni Belson",
    handle: "LeadTrap",
    imageUrl: "/images/testimonials/yoni.jpeg",
  },
};

const slimTestimonial: Testimonial = {
  body: "我是在正打算雇一位虚拟助理来管理邮件时遇到 Inbox Zero 的，但试用之后，它彻底改变了我的工作方式。",
  author: {
    name: "Slim Labassi",
    handle: "Boomgen",
    imageUrl: "/images/testimonials/slim.png",
  },
};

const willTestimonial: Testimonial = {
  body: "我喜欢它的灵活性和自定义选项，它是我很久以来第一个让收件箱重新受控的工具。谢谢！",
  author: {
    name: "Will Brierly",
    handle: "DreamKey",
    imageUrl: "/images/testimonials/will.jpeg",
  },
};

const valentineTestimonial: Testimonial = {
  body: "我是一名高管，曾被每天数百封邮件淹没，非常依赖我的行政助理来管理邮件。我最喜欢 Inbox Zero 的地方是它无缝替代了那整个职能 —— 智能自动化、优先级排序和整理功能，就像在我的工作流中内置了一位专属邮件助手。",
  author: {
    name: "Valentine Nwachukwu",
    handle: "Zaden Technologies",
    imageUrl: "/images/testimonials/valentine.png",
  },
};

const joelTestimonial: Testimonial = {
  body: "我试过很多工具，这是第一个在起草的回复中真正捕捉到我口吻的。",
  author: {
    name: "Joel Neuenhaus",
    handle: "Outbound Legal",
    imageUrl: "/images/testimonials/joel.jpeg",
  },
};

const alexTestimonial: Testimonial = {
  body: "为这个工具超级兴奋！做得好，肯定用得上 —— 我一直在等这样的工具，把它作为邮件之上的一层实在太合理了。",
  author: {
    name: "Alex Bass",
    handle: "Efficient App",
    imageUrl:
      "https://ph-avatars.imgix.net/3523155/original?auto=compress&codec=mozjpeg&cs=strip&auto=format&w=120&h=120&fit=crop&dpr=2",
  },
};

const jamesTestimonial: Testimonial = {
  body: "兄弟，你的工具正是我找了很久的东西哈哈。简直是天赐之物",
  author: {
    name: "James",
    handle: "@james",
    imageUrl: "/images/testimonials/midas-hofstra-a6PMA5JEmWE-unsplash.jpg",
  },
};

const steveTestimonial: Testimonial = {
  body: "我主要是希望让我的收件箱别那么乱。随着邮件被淹没，我一直在丢失本该完成的任务。到目前为止它真的帮了大忙。",
  author: {
    name: "Steve Radabaugh",
    handle: "@stevenpaulr",
    imageUrl: "/images/home/testimonials/steve-rad.png",
  },
};

const wilcoTestimonial: Testimonial = {
  body: `终于有一款"退订应用"，能让你*真正*退订，并使用 Gmail 过滤器进行过滤（而不是总依赖第三方应用来过滤那些邮件）。对我来说这是个大优点，这样我所有的过滤器都在一处（也就是 Gmail 过滤器里）。干得漂亮！我已经是粉丝了 :)`,
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
        已有 {userCount} 位用户花更少时间在邮件上
      </SectionHeading>
      <SectionSubtitle>
        {`我们的客户很喜欢用 ${BRAND_NAME} 节省时间。`}
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
  return (
    <Card key={testimonial.author.handle} className={className}>
      <CardContent>
        {variant === "featured" ? (
          <Paragraph
            color="gray-700"
            size="lg"
            className="font-semibold leading-7 tracking-tight"
          >
            {testimonial.body}
          </Paragraph>
        ) : (
          <Paragraph size="md" color="gray-500">
            {testimonial.body}
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
        {variant === "featured" && testimonial.author.logoUrl ? (
          <Image
            className="h-8 w-auto flex-none"
            src={testimonial.author.logoUrl}
            alt={testimonial.author.name}
            height={32}
            width={98}
            unoptimized
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
