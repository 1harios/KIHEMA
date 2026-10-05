# Личные стикеры совместного просмотра

Созданы встроенным imagegen из пяти фотографий, предоставленных пользователем для публикации в чате. PNG с прозрачным альфа-каналом; фон исходных фотографий удалён. Не передавайте эти файлы третьим сторонам вне функции совместного просмотра без согласия владельца.

Файлы: `static/stickers/drink.png`, `snack.png`, `kiss.png`, `chopsticks.png`, `smile.png`.

Стикеры отправляются по закрытым идентификаторам, а не произвольным URL. Оба участника получают серверное событие и видят стикер поверх видео. PNG доступны посетителям сайта, как и остальные статические ресурсы. Исходные фотографии в репозиторий не включены.

## Использованные промпты

### drink

Use case: background-extraction. Asset type: personal photo sticker for a watch-party chat. Input image 1 is the EDIT TARGET, not a style reference. Primary request: remove only the background and isolate the woman with closed eyes sipping from a straw; keep the entire yellow drink glass, straw, hands, hair and black hoodie as one clean photographic cutout on a genuinely transparent PNG alpha background. Preserve this exact person's identity, facial features, expression, pose, clothing, proportions, colors, skin texture and original photographic details. Do not redraw, beautify, cartoonize, alter expression or add objects. Frame the retained subject tightly with a small transparent margin and preserve natural hair edges. Remove all cafe/room/table/chair/background scenery outside the retained subject. No rectangular background, checkerboard pixels, text, stickersheets, collage, extra faces, decorative outlines or shadows. One separate sticker only.

### snack

Use case: background-extraction. Asset type: personal photo sticker for a watch-party chat. Input image 1 is the EDIT TARGET, not a style reference. Primary request: remove only the background and isolate the woman holding food in her raised hand; keep her face, hair, raised hand with food, beige shirt and upper torso, remove surrounding wrappers, chair and room as one clean photographic cutout on a genuinely transparent PNG alpha background. Preserve this exact person's identity, facial features, expression, pose, clothing, proportions, colors, skin texture and original photographic details. Do not redraw, beautify, cartoonize, alter expression or add objects. Frame the retained subject tightly with a small transparent margin and preserve natural hair edges. Remove all cafe/room/table/chair/background scenery outside the retained subject. No rectangular background, checkerboard pixels, text, stickersheets, collage, extra faces, decorative outlines or shadows. One separate sticker only.

### kiss

Use case: background-extraction. Asset type: personal photo sticker for a watch-party chat. Input image 1 is the EDIT TARGET, not a style reference. Primary request: remove only the background and isolate the woman blowing a kiss with closed eyes and hand by her mouth; keep her face, long hair, hand, rings, bracelet and upper torso as one clean photographic cutout on a genuinely transparent PNG alpha background. Preserve this exact person's identity, facial features, expression, pose, clothing, proportions, colors, skin texture and original photographic details. Do not redraw, beautify, cartoonize, alter expression or add objects. Frame the retained subject tightly with a small transparent margin and preserve natural hair edges. Remove all cafe/room/table/chair/background scenery outside the retained subject. No rectangular background, checkerboard pixels, text, stickersheets, collage, extra faces, decorative outlines or shadows. One separate sticker only.

### chopsticks

Use case: background-extraction. Asset type: personal photo sticker for a watch-party chat. Input image 1 is the EDIT TARGET, not a style reference. Primary request: remove only the background and isolate the woman eating with pink chopsticks, including her hand, chopsticks, long hair, black shirt, necklaces, and the entire orange drink glass as one clean photographic cutout on a genuinely transparent PNG alpha background. Preserve this exact person's identity, facial features, expression, pose, clothing, proportions, colors, skin texture and original photographic details. Do not redraw, beautify, cartoonize, alter expression or add objects. Frame the retained subject tightly with a small transparent margin and preserve natural hair edges. Remove all cafe/room/table/chair/background scenery outside the retained subject. No rectangular background, checkerboard pixels, text, stickersheets, collage, extra faces, decorative outlines or shadows. One separate sticker only.

### smile

Use case: background-extraction. Asset type: personal photo sticker for a watch-party chat. Input image 1 is the EDIT TARGET, not a style reference. Primary request: remove only the background and isolate the reclining woman smiling slightly, keep her head, hair, fluffy hair tie, black shirt and upper torso; remove pillow, bed and room as one clean photographic cutout on a genuinely transparent PNG alpha background. Preserve this exact person's identity, facial features, expression, pose, clothing, proportions, colors, skin texture and original photographic details. Do not redraw, beautify, cartoonize, alter expression or add objects. Frame the retained subject tightly with a small transparent margin and preserve natural hair edges. Remove all cafe/room/table/chair/background scenery outside the retained subject. No rectangular background, checkerboard pixels, text, stickersheets, collage, extra faces, decorative outlines or shadows. One separate sticker only.
