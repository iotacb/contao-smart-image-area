<?php

declare(strict_types=1);

use Contao\CoreBundle\DependencyInjection\Attribute\AsCallback;
use Contao\CoreBundle\DependencyInjection\Compiler\DataContainerCallbackPass;
use Contao\CoreBundle\EventListener\DataContainerCallbackListener;
use Contao\DataContainer;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\Asset\Context\RequestStackContext;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Asset\PathPackage;
use Symfony\Component\Asset\VersionStrategy\EmptyVersionStrategy;
use Symfony\Component\DependencyInjection\ChildDefinition;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Translation\Loader\YamlFileLoader;
use Symfony\Component\Translation\Translator;
use Symfony\Component\Yaml\Yaml;
use Symfony\Bridge\Twig\Extension\TranslationExtension;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;
use iotacb\SmartImageArea\EventListener\ImageAreaListener;
use iotacb\SmartImageArea\SmartImageAreaBundle;

$projectDir = \dirname(__DIR__, 3);
$autoload = $argv[1] ?? $projectDir.'/vendor/autoload.php';
$loader = require $autoload;
$loader->addPsr4('iotacb\\SmartImageArea\\', \dirname(__DIR__).'/src/');

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
    echo 'PASS: '.$message.PHP_EOL;
}

$bundle = new SmartImageAreaBundle();
check(realpath($bundle->getPath()) === realpath(\dirname(__DIR__)), 'Bundle resources resolve to the package root');

$container = new ContainerBuilder();
$container->setParameter('kernel.environment', 'test');
$container->setParameter('kernel.build_dir', sys_get_temp_dir().'/contao-smart-image-area-container');
$container->registerAttributeForAutoconfiguration(AsCallback::class, static function (ChildDefinition $definition, AsCallback $attribute, Reflector $reflector): void {
    $attributes = get_object_vars($attribute);
    if ($reflector instanceof ReflectionMethod) {
        $attributes['method'] = $reflector->getName();
    }
    $definition->addTag('contao.callback', $attributes);
});
foreach ([Security::class, Packages::class, Environment::class] as $class) {
    $container->register($class, $class)->setSynthetic(true)->setPublic(true);
}
$container->register('contao.listener.data_container_callback', DataContainerCallbackListener::class)->setSynthetic(true)->setPublic(true);
$container->addCompilerPass(new DataContainerCallbackPass(), PassConfig::TYPE_BEFORE_REMOVING);
$bundle->getContainerExtension()->load([], $container);
$container->compile();
$callbacks = $container->getDefinition('contao.listener.data_container_callback')->getMethodCalls();
check(isset($callbacks[0][1][0]['tl_files']['config.onpalette_callback'][-100]), 'Container compilation registers the palette callback after core callbacks');
check(isset($callbacks[0][1][0]['tl_files']['fields.waSmartImageArea.input_field_callback']), 'Container compilation registers the rendering callback');

$checker = new class {
    public ?string $denied = null;
    public function isGranted(mixed $attribute, mixed $subject = null, mixed $decision = null): bool
    {
        return $subject !== $this->denied;
    }
};
$securityContainer = new Container();
$securityContainer->set('security.authorization_checker', $checker);
$security = new Security($securityContainer);
$requests = new RequestStack();
$requests->push(Request::create('https://example.test/subdirectory/contao'));
$assets = new Packages(new PathPackage('/subdirectory', new EmptyVersionStrategy(), new RequestStackContext($requests)));
$twigLoader = new FilesystemLoader();
$twigLoader->addPath(\dirname(__DIR__).'/contao/templates', 'Contao');
$twig = new Environment($twigLoader, ['strict_variables' => true, 'autoescape' => 'html']);
$translator = new Translator('en');
$translator->addLoader('yaml', new YamlFileLoader());
foreach (['en', 'de'] as $locale) {
    $translator->addResource('yaml', \dirname(__DIR__).'/translations/contao_tl_files.'.$locale.'.yaml', $locale, 'contao_tl_files');
}
$twig->addExtension(new TranslationExtension($translator));
$container->set(Security::class, $security);
$container->set(Packages::class, $assets);
$container->set(Environment::class, $twig);
$listener = $container->get(ImageAreaListener::class);
$dc = new class extends DataContainer {
    public function __construct() {}
    public function getPalette() { return ''; }
    protected function save($varValue) {}
};

$palette = 'preview,name,importantPartX,importantPartY,importantPartWidth,importantPartHeight;meta';
$adjusted = $listener->adjustPalette($palette, $dc);
check(str_starts_with($adjusted, 'preview,waSmartImageArea,name,'), 'Helper follows the native image preview');
check($listener->adjustPalette($adjusted, $dc) === $adjusted, 'Palette registration is idempotent');
check($listener->adjustPalette('preview,name;meta', $dc) === 'preview,name;meta', 'Non-image palettes remain unchanged');

$GLOBALS['TL_JAVASCRIPT'] = ['another-extension.js'];
$GLOBALS['TL_CSS'] = ['another-extension.css'];
$html = $listener->render($dc);
check(str_contains($html, 'data-wa-image-area') && str_contains($html, 'Detect area automatically'), 'Twig renders the English helper');
check(str_contains($html, 'data-pending="Not saved yet') && str_contains($html, 'data-discard="Discard suggestion"'), 'Twig renders the suggestion states');
check(str_contains($html, '/subdirectory/bundles/smartimagearea/detector.worker.js'), 'Worker URL respects application subdirectories');
$listener->render($dc);
check(2 === \count($GLOBALS['TL_JAVASCRIPT']), 'JavaScript is included once and preserves other extensions');
check(['another-extension.css', 'bundles/smartimagearea/image-area.css'] === $GLOBALS['TL_CSS'], 'Stylesheet is included once and preserves other extensions');
$translator->setLocale('de');
check(str_contains($listener->render($dc), 'Bereich automatisch erkennen'), 'German helper translations render');
foreach (['importantPartX', 'importantPartY', 'importantPartWidth', 'importantPartHeight'] as $field) {
    $checker->denied = 'tl_files::'.$field;
    check('' === $listener->render($dc), 'No helper without permission for '.$field);
}

foreach (glob(\dirname(__DIR__).'/config/*.yaml') as $file) {
    Yaml::parseFile($file);
}
echo 'PASS: service YAML parses'.PHP_EOL;
