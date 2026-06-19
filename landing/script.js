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
