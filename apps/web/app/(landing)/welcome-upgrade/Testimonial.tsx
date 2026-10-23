import { ABTestimonial } from "@/components/PersonWithLogo";

export function Testimonial() {
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <blockquote className="text-xl font-semibold text-gray-900 sm:text-2xl lg:text-3xl leading-relaxed">
            “我们每周节省 60 多个小时，团队从 20 人发展到 50
            人。就像拥有一个永不休息的助手。”
          </blockquote>
          <div className="mt-8">
            <ABTestimonial />
          </div>
        </div>
      </div>
    </div>
  );
}
