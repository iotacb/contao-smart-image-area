<?php

declare(strict_types=1);

namespace iotacb\SmartImageArea\EventListener;

use Contao\CoreBundle\DataContainer\PaletteManipulator;
use Contao\CoreBundle\DependencyInjection\Attribute\AsCallback;
use Contao\CoreBundle\Security\ContaoCorePermissions;
use Contao\DataContainer;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\Asset\Packages;
use Twig\Environment;

final class ImageAreaListener
{
    public function __construct(
        private readonly Security $security,
        private readonly Packages $assets,
        private readonly Environment $twig,
    ) {
    }

    #[AsCallback(table: 'tl_files', target: 'config.onpalette', priority: -100)]
    public function adjustPalette(string $palette, DataContainer $dc): string
    {
        $fields = preg_split('/[,;]/', $palette);

        if (!\in_array('preview', $fields, true) || \in_array('waSmartImageArea', $fields, true)) {
            return $palette;
        }

        foreach (['importantPartX', 'importantPartY', 'importantPartWidth', 'importantPartHeight'] as $field) {
            if (!\in_array($field, $fields, true)) {
                return $palette;
            }
        }

        return PaletteManipulator::create()
            ->addField('waSmartImageArea', 'preview', PaletteManipulator::POSITION_AFTER)
            ->applyToString($palette);
    }

    #[AsCallback(table: 'tl_files', target: 'fields.waSmartImageArea.input_field')]
    public function render(DataContainer $dc): string
    {
        foreach (['importantPartX', 'importantPartY', 'importantPartWidth', 'importantPartHeight'] as $field) {
            if (!$this->security->isGranted(ContaoCorePermissions::USER_CAN_EDIT_FIELD_OF_TABLE, 'tl_files::'.$field)) {
                return '';
            }
        }

        $assets = [
            'TL_CSS' => 'bundles/smartimagearea/image-area.css',
            'TL_JAVASCRIPT' => 'bundles/smartimagearea/image-area.js|defer',
        ];

        foreach ($assets as $global => $asset) {
            if (!\in_array($asset, $GLOBALS[$global] ?? [], true)) {
                $GLOBALS[$global][] = $asset;
            }
        }

        return $this->twig->render('@Contao/backend/wa_smart_image_area.html.twig', [
            'workerUrl' => $this->assets->getUrl('bundles/smartimagearea/detector.worker.js'),
        ]);
    }
}
