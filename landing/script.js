const tiltCards = document.querySelectorAll("[data-tilt]");

for (const card of tiltCards) {
  const baseTransform = getComputedStyle(card).transform === "none" ? "" : getComputedStyle(card).transform;

  card.addEventListener("pointermove", (event) => {
    if (window.matchMedia("(max-width: 760px)").matches) return;

    const bounds = card.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    const rotateX = y * -5;
    const rotateY = x * 5;

    card.style.transform = `${baseTransform} perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
  });

  card.addEventListener("pointerleave", () => {
    card.style.transform = baseTransform;
  });
}

const faqItems = document.querySelectorAll(".faq-grid details");

for (const item of faqItems) {
  const summary = item.querySelector("summary");
  summary?.addEventListener("click", (event) => {
    event.preventDefault();
    const shouldOpen = !item.open;
    for (const other of faqItems) {
      other.open = false;
    }
    item.open = shouldOpen;
  });
}

const whatsappButton = document.querySelector(".whatsapp-float");
const protectedSections = document.querySelectorAll(".notification-section, .pricing, .final-cta, .site-footer");

if (whatsappButton && protectedSections.length && "IntersectionObserver" in window) {
  const visibleSections = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleSections.add(entry.target);
      else visibleSections.delete(entry.target);
    }
    whatsappButton.classList.toggle("is-hidden", visibleSections.size > 0);
  }, { threshold: 0.08 });

  for (const section of protectedSections) observer.observe(section);
}
